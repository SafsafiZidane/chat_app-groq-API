from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import os
from groq import Groq
from dotenv import load_dotenv
import tempfile
import shutil
# LangChain imports
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq
from langchain.chains import RetrievalQA
from langchain_huggingface import HuggingFaceEmbeddings
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv()
GROQ_API_KEY = os.getenv('GROQ_API_KEY')

# FastAPI app
app = FastAPI(title="Chatbot API", description="API for general chat and PDF-specific questions")

# More permissive CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=False,  # Set to False when using allow_origins=["*"]
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Global variables for PDF processing
vector_db_instance = None
pdf_loaded = False

# Pydantic models
class ChatMessage(BaseModel):
    role: str
    content: str

class GeneralChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []

class PDFChatRequest(BaseModel):
    question: str

class ChatResponse(BaseModel):
    response: str
    sources: Optional[List[str]] = None

# Helper functions
def llm_answer(history):
    """Generate answer using Groq LLM for general chat"""
    try:
        client = Groq(api_key=GROQ_API_KEY)
        
        # Convert history to the format expected by Groq
        messages = []
        for msg in history:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama-3.3-70b-versatile",
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error with Groq API: {str(e)}")

def pdf_loader(pdf_file):
    """Load PDF document"""
    loader = PyPDFLoader(pdf_file)
    return loader.load()

def split_document(documents):
    """Split documents into chunks"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, 
        chunk_overlap=30
    )
    return splitter.split_documents(documents)

def create_vector_db(chunks):
    """Create FAISS vector database"""
    embedding_model = HuggingFaceEmbeddings(model_name='all-MiniLM-L6-v2')
    vdb = FAISS.from_documents(chunks, embedding_model)
    return vdb

def rag_query(vdb, question):
    """Perform RAG query"""
    retriever = vdb.as_retriever()
    llm = ChatGroq(api_key=GROQ_API_KEY, model='llama-3.3-70b-versatile')
    
    rag_chain = RetrievalQA.from_chain_type(
        llm=llm,
        retriever=retriever,
        return_source_documents=True
    )
    
    return rag_chain({'query': question})

# API Endpoints

@app.get("/")
async def root():
    return {"message": "Chatbot API is running"}

@app.get("/status")
async def get_status():
    """Get the current status of the chatbot"""
    return {
        "general_chat": "Available",
        "pdf_chat": "Available" if pdf_loaded else "No PDF loaded",
        "pdf_loaded": pdf_loaded
    }

@app.post("/chat/general", response_model=ChatResponse)
async def general_chat(request: GeneralChatRequest):
    """General chat endpoint - answers any question without PDF dependency"""
    try:
        # Add the new message to history
        history = request.history.copy()
        history.append(ChatMessage(role="user", content=request.message))
        
        # Get response from LLM
        response = llm_answer(history)
        
        return ChatResponse(response=response)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing general chat: {str(e)}")

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload and process PDF for RAG queries"""
    global vector_db_instance, pdf_loaded
    
    try:
        # Check if file is PDF
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            shutil.copyfileobj(file.file, tmp_file)
            tmp_file_path = tmp_file.name
        
        # Process PDF
        print("Loading PDF...")
        documents = pdf_loader(tmp_file_path)
        
        print("Splitting document...")
        chunks = split_document(documents)
        
        print("Creating vector database...")
        vector_db_instance = create_vector_db(chunks)
        
        pdf_loaded = True
        
        # Clean up temporary file
        os.unlink(tmp_file_path)
        
        return {"message": f"PDF '{file.filename}' uploaded and processed successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")

@app.post("/chat/pdf", response_model=ChatResponse)
async def pdf_chat(request: PDFChatRequest):
    """PDF-specific chat endpoint - answers questions based on uploaded PDF"""
    global vector_db_instance, pdf_loaded
    
    try:
        if not pdf_loaded or vector_db_instance is None:
            raise HTTPException(
                status_code=400, 
                detail="No PDF loaded. Please upload a PDF first using /upload-pdf endpoint"
            )
        
        # Perform RAG query
        results = rag_query(vector_db_instance, request.question)
        
        # Extract sources
        sources = []
        for doc in results['source_documents']:
            source = doc.metadata.get('source', 'Unknown')
            if source not in sources:
                sources.append(source)
        
        return ChatResponse(
            response=results['result'],
            sources=sources
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF chat: {str(e)}")

@app.delete("/pdf")
async def clear_pdf():
    """Clear the loaded PDF and reset the system"""
    global vector_db_instance, pdf_loaded
    
    vector_db_instance = None
    pdf_loaded = False
    
    return {"message": "PDF cleared successfully"}

# Health check
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
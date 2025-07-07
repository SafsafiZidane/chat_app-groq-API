import React, { useState, useEffect, useRef } from 'react';
import "./App.css"

const ChatbotInterface = () => {
  const API_BASE = 'http://127.0.0.1:8000';
  const [currentTab, setCurrentTab] = useState('general');
  const [messages, setMessages] = useState([
    { sender: 'bot', text: "👋 Hello! I'm your AI assistant. You can ask me anything in General Chat, or upload a PDF for document-specific questions.", sources: [] }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [pdfFile, setPdfFile] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkStatus = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${API_BASE}/status`, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setStatus(`General Chat: ${data.general_chat}<br>
                 PDF Chat: ${data.pdf_chat}<br>
                 PDF Loaded: ${data.pdf_loaded ? '✅' : '❌'}`);
      setConnectionStatus('connected');
    } catch (error) {
      console.error('Status check error:', error);
      if (error.name === 'AbortError') {
        setStatus('❌ Connection timeout - Server may be down');
      } else {
        setStatus('❌ Cannot connect to server - Please check if backend is running');
      }
      setConnectionStatus('disconnected');
    }
  };

  const switchTab = (tab) => {
    setCurrentTab(tab);
    setMessages([
      { 
        sender: 'bot', 
        text: tab === 'general' 
          ? '👋 Hello! Ask me anything you want to know.' 
          : '📄 Ask questions about the uploaded PDF document.',
        sources: [] 
      }
    ]);
  };

  const sendMessage = async () => {
    const message = inputValue.trim();
    if (!message) return;

    // Check connection first
    if (connectionStatus === 'disconnected') {
      setMessages(prev => [...prev, 
        { sender: 'user', text: message, sources: [] },
        { sender: 'bot', text: '❌ Cannot send message - Server is not connected. Please wait for reconnection.', sources: [] }
      ]);
      setInputValue('');
      return;
    }

    // Add user message
    const newMessages = [...messages, { sender: 'user', text: message, sources: [] }];
    setMessages(newMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      let response;
      if (currentTab === 'general') {
        response = await fetch(`${API_BASE}/chat/general`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });
      } else {
        response = await fetch(`${API_BASE}/chat/pdf`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: message }),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      setMessages([
        ...newMessages,
        { 
          sender: 'bot', 
          text: data.response, 
          sources: data.sources || [] 
        }
      ]);
      
    } catch (error) {
      console.error('Send message error:', error);
      let errorMessage = '❌ ';
      
      if (error.name === 'AbortError') {
        errorMessage += 'Request timeout - Please try again';
      } else if (error.message.includes('fetch')) {
        errorMessage += 'Network error - Cannot connect to server';
        setConnectionStatus('disconnected');
      } else {
        errorMessage += `Error: ${error.message}`;
      }
      
      setMessages([
        ...newMessages,
        { 
          sender: 'bot', 
          text: errorMessage, 
          sources: [] 
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadPDF = async () => {
    if (!pdfFile) {
      alert('Please select a PDF file');
      return;
    }

    if (connectionStatus === 'disconnected') {
      alert('❌ Cannot upload - Server is not connected');
      return;
    }

    const formData = new FormData();
    formData.append('file', pdfFile);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for upload

      const response = await fetch(`${API_BASE}/upload-pdf`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      alert('✅ PDF uploaded successfully!');
      checkStatus(); // Refresh status
      
    } catch (error) {
      console.error('Upload error:', error);
      let errorMessage = '❌ ';
      
      if (error.name === 'AbortError') {
        errorMessage += 'Upload timeout - File might be too large';
      } else if (error.message.includes('fetch')) {
        errorMessage += 'Network error - Cannot connect to server';
        setConnectionStatus('disconnected');
      } else {
        errorMessage += `Upload error: ${error.message}`;
      }
      
      alert(errorMessage);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="container">
      <div className="sidebar">
        <h2>🤖 Chatbot</h2>
        <div className="tab-buttons">
          <button 
            className={`tab-btn ${currentTab === 'general' ? 'active' : ''}`}
            onClick={() => switchTab('general')}
          >
            💬 General Chat
          </button>
          <button 
            className={`tab-btn ${currentTab === 'pdf' ? 'active' : ''}`}
            onClick={() => switchTab('pdf')}
          >
            📄 PDF Chat
          </button>
        </div>
        
        <div className="pdf-upload">
          <h3>📎 Upload PDF</h3>
          <input 
            type="file" 
            id="pdfFile" 
            accept=".pdf" 
            className="file-input"
            onChange={(e) => setPdfFile(e.target.files[0])}
          />
          <button 
            className="upload-btn" 
            onClick={uploadPDF}
            disabled={connectionStatus === 'disconnected'}
          >
            Upload
          </button>
        </div>
        
        <div className="status">
          <strong>Status:</strong>
          <div className={`connection-indicator ${connectionStatus}`}>
            {connectionStatus === 'connected' ? '🟢' : '🔴'} 
            {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </div>
          <span dangerouslySetInnerHTML={{ __html: status }} />
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          {currentTab === 'general' ? '💬 General Chat' : '📄 PDF Chat'}
        </div>
        
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div 
              key={index} 
              className={`message ${message.sender}-message`}
            >
              {message.text}
              {message.sources && message.sources.length > 0 && (
                <div className="sources">
                  📚 Sources: {message.sources.join(', ')}
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="loading show">
              🤔 Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="chat-input">
          <input 
            type="text" 
            className="message-input" 
            placeholder={connectionStatus === 'connected' ? "Type your message..." : "Server disconnected..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={connectionStatus === 'disconnected'}
          />
          <button 
            className="send-btn" 
            onClick={sendMessage}
            disabled={isLoading || connectionStatus === 'disconnected'}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatbotInterface;
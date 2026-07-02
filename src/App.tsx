import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Send, BookOpen, MessageSquare, Loader2, Bot, Info, Settings2, Search, RefreshCw, Library } from 'lucide-react';
import Markdown from 'react-markdown';
import { Message, Model } from './types';

export default function App() {
  const [books, setBooks] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  
  const [topicQuery, setTopicQuery] = useState('');
  const [extractedTopic, setExtractedTopic] = useState<{ query: string; content: string } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchBooks = async () => {
    setIsLoadingBooks(true);
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      if (data.books) {
        setBooks(data.books);
      }
    } catch (err) {
      console.error("Failed to fetch books:", err);
    } finally {
      setIsLoadingBooks(false);
    }
  };

  useEffect(() => {
    fetchBooks();
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setModels(data.models);
          setSelectedModel(data.models[0].id);
        }
      })
      .catch(err => console.error("Failed to load models:", err));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatting]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (data.error) {
        alert("Upload failed: " + data.error);
        return;
      }
      
      await fetchBooks();
      setSelectedBook(data.filename);
      setExtractedTopic(null);
      setMessages([]);
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("An error occurred while uploading the file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleBookSelect = (book: string) => {
    setSelectedBook(book);
    setExtractedTopic(null);
    setMessages([]);
    setTopicQuery('');
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleExtractTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBook || !topicQuery.trim()) return;

    setIsExtracting(true);
    setExtractedTopic(null);
    setMessages([]);

    try {
      const res = await fetch('/api/extract-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedBook,
          topic: topicQuery.trim()
        })
      });
      const data = await res.json();
      
      if (data.error) {
        alert("Error: " + data.error);
      } else {
        setExtractedTopic({ query: topicQuery.trim(), content: data.topicContent });
        setMessages([{ role: 'assistant', content: `I've extracted relevant sections about **"${topicQuery.trim()}"** from ${selectedBook}. What would you like to know?` }]);
      }
    } catch (error) {
      console.error("Extraction error:", error);
      alert("Failed to extract topic.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !extractedTopic || !selectedBook) return;

    const userMessage: Message = { role: 'user', content: inputMessage.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputMessage('');
    setIsChatting(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedBook,
          topic: extractedTopic.query,
          topicContent: extractedTopic.content,
          messages: newMessages.filter(m => m.role !== 'system'),
          model: selectedModel,
        }),
      });
      
      const data = await res.json();
      
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `**Error:** ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "**Error:** Failed to communicate with the server." }]);
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#FAFAFA] font-sans overflow-hidden text-gray-900">
      
      {/* Sidebar: Library & Upload */}
      <div className={`
        fixed inset-y-0 left-0 z-20 w-72 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 flex flex-col shadow-sm
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Library className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Library</h1>
          </div>
          <button onClick={fetchBooks} className="text-gray-400 hover:text-blue-600 transition-colors" title="Refresh Library">
            <RefreshCw className={`w-4 h-4 ${isLoadingBooks ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>

        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 py-2.5 px-4 rounded-xl font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isUploading ? 'Uploading...' : 'Upload PDF'}
          </button>
          <p className="text-xs text-gray-400 text-center mt-3 font-medium">Or upload via SSH to ./books</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
            Available Books
          </div>
          
          <div className="space-y-1">
            {books.length === 0 && !isLoadingBooks ? (
              <div className="text-sm text-gray-400 px-2 py-4 text-center">No books found in library.</div>
            ) : (
              books.map((book) => (
                <button
                  key={book}
                  onClick={() => handleBookSelect(book)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-start gap-3 ${
                    selectedBook === book
                      ? 'bg-blue-50/80 border-blue-100 shadow-sm text-blue-900'
                      : 'hover:bg-gray-50 text-gray-600'
                  } border border-transparent`}
                >
                  <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${selectedBook === book ? 'text-blue-600' : 'text-gray-400'}`} />
                  <div className="font-medium text-sm break-words leading-snug">{book}</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-10 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main Content: Split View */}
      <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-white">
        
        {/* Document Viewer / Topic Search Pane */}
        <div className="flex-1 border-r border-gray-200 flex flex-col min-w-[300px] bg-white h-1/2 md:h-full relative shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
          <div className="h-auto min-h-[56px] border-b border-gray-100 flex flex-col justify-center px-4 md:px-6 bg-white/80 backdrop-blur shrink-0 sticky top-0 z-10 py-3 gap-3">
            <div className="flex items-center gap-3">
              <button 
                className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100"
                onClick={() => setIsSidebarOpen(true)}
              >
                <Library className="w-5 h-5" />
              </button>
              <h2 className="font-medium text-gray-900 flex items-center gap-2 truncate">
                <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="truncate">{selectedBook || 'Select a Book'}</span>
              </h2>
            </div>
            
            {selectedBook && (
              <form onSubmit={handleExtractTopic} className="relative flex items-center w-full max-w-lg">
                <Search className="w-4 h-4 text-gray-400 absolute left-3" />
                <input
                  type="text"
                  placeholder="Enter a topic to extract and learn about..."
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-10 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                <button
                  type="submit"
                  disabled={!topicQuery.trim() || isExtracting}
                  className="absolute right-1.5 py-1.5 px-3 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {isExtracting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Extract
                </button>
              </form>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-[#FCFCFC]">
            {extractedTopic ? (
              <div className="max-w-3xl mx-auto">
                <div className="mb-6 pb-4 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Extracted Context</h3>
                  <h1 className="text-2xl font-bold text-gray-900">Topic: {extractedTopic.query}</h1>
                </div>
                <p className="text-gray-800 leading-relaxed font-serif text-lg md:text-xl whitespace-pre-wrap">
                  {extractedTopic.content}
                </p>
              </div>
            ) : isExtracting ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <p className="text-sm text-gray-500">Searching and extracting relevant sections...</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4 max-w-sm mx-auto text-center">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center border border-blue-100/50 mb-2">
                  <Search className="w-8 h-8 text-blue-400" />
                </div>
                {selectedBook ? (
                  <>
                    <h3 className="text-gray-800 font-medium">Search for a topic</h3>
                    <p className="text-sm text-gray-500">Enter a specific topic you want to learn about from this book. We'll extract the relevant sections so you can ask the AI questions.</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-gray-800 font-medium">Select or upload a book</h3>
                    <p className="text-sm text-gray-500">Choose a book from the library on the left, or upload a new one via the web or SSH to begin.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Chat Pane */}
        <div className="w-full md:w-[420px] lg:w-[480px] bg-gray-50/50 flex flex-col h-1/2 md:h-full shrink-0">
          <div className="h-14 border-b border-gray-200/60 flex items-center px-4 justify-between bg-white shrink-0">
            <h2 className="font-medium text-gray-800 flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-500" />
              NIM Tutor
            </h2>
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-gray-400" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-sm text-gray-600 outline-none cursor-pointer focus:ring-0 max-w-[140px] truncate"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-400 gap-3">
                <MessageSquare className="w-10 h-10 text-gray-300 mb-2" />
                <p className="text-sm">Extract a topic to start chatting with the AI.</p>
                <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-lg flex gap-2 text-left w-full mt-4 items-start border border-blue-100/50">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>Remember to set your NVIDIA_API_KEY in the environment variables.</p>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-gray-900 text-white rounded-br-sm shadow-sm' 
                        : 'bg-white text-gray-800 border border-gray-200/60 rounded-bl-sm shadow-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="markdown-body prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))
            )}
            {isChatting && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200/60 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white border-t border-gray-100 shrink-0">
            <form onSubmit={handleSendMessage} className="relative flex items-end">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                placeholder={extractedTopic ? `Ask about "${extractedTopic.query}"...` : "Extract a topic first"}
                disabled={!extractedTopic || isChatting}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none max-h-32 disabled:opacity-50 disabled:bg-gray-50"
                rows={1}
                style={{
                  minHeight: '46px',
                  height: inputMessage.split('\n').length > 1 ? `${Math.min(inputMessage.split('\n').length * 24 + 24, 128)}px` : '46px'
                }}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || !extractedTopic || isChatting}
                className="absolute right-2 bottom-1.5 p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Send, BookOpen, MessageSquare, Loader2, Bot, Info, Settings2, RefreshCw, Library, PanelRightClose, PanelRightOpen, Download } from 'lucide-react';
import Markdown from 'react-markdown';
import { Message, Model } from './types';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

export default function App() {
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  const [books, setBooks] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [extractedTopic, setExtractedTopic] = useState<{ query: string; content: string; pdfBase64: string } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);

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
    setStartPage('');
    setEndPage('');
    setIndexTopics([]);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const [isGeneratingIndex, setIsGeneratingIndex] = useState(false);
  const [indexTopics, setIndexTopics] = useState<{title: string, startPage: number, endPage: number}[]>([]);
  const [hasNativeIndex, setHasNativeIndex] = useState(false);
  const [isParsingIndex, setIsParsingIndex] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const handleDocumentLoad = async (e: any) => {
    const doc = e.doc;
    setIsParsingIndex(true);
    setIndexTopics([]);
    try {
      const outline = await doc.getOutline();
      if (outline && outline.length > 0) {
        const topics: {title: string, startPage: number, endPage: number}[] = [];
        
        const traverse = async (items: any[]) => {
          for (const item of items) {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await doc.getDestination(dest);
            }
            if (dest) {
              try {
                // PDF.js getPageIndex can take a Ref object {num, gen} which is usually dest[0]
                const ref = typeof dest[0] === 'object' ? dest[0] : dest;
                const pageIndex = await doc.getPageIndex(ref);
                if (pageIndex !== null && pageIndex !== undefined) {
                   topics.push({ title: item.title, startPage: pageIndex + 1, endPage: 0 });
                }
              } catch (err) {
                 console.error("Failed to get page index", err);
              }
            }
            if (item.items && item.items.length > 0) {
              await traverse(item.items);
            }
          }
        };
        
        await traverse(outline);
        
        if (topics.length > 0) {
          topics.sort((a, b) => a.startPage - b.startPage);
          
          for (let i = 0; i < topics.length; i++) {
            if (i < topics.length - 1) {
                let nextStart = topics[i+1].startPage;
                topics[i].endPage = nextStart > topics[i].startPage ? nextStart - 1 : topics[i].startPage;
            } else {
                topics[i].endPage = doc.numPages;
            }
          }
          
          const uniqueTopics = topics.filter((t, index, self) => 
            index === self.findIndex((t2) => (
              t.startPage === t2.startPage && t.title === t2.title
            ))
          );
          
          setIndexTopics(uniqueTopics);
          setHasNativeIndex(true);
        } else {
          setHasNativeIndex(false);
        }
      } else {
        setHasNativeIndex(false);
      }
    } catch (err) {
      console.error("Error parsing outline", err);
    } finally {
      setIsParsingIndex(false);
    }
  };

  const handlePageChange = (e: any) => {
    setCurrentPage(e.currentPage + 1);
  };

  const handleGenerateIndex = async () => {
    if (!selectedBook) return;
    setIsGeneratingIndex(true);
    setIndexTopics([]);
    try {
      const res = await fetch('/api/generate-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedBook, modelId: selectedModel || 'meta/llama-3.1-70b-instruct' })
      });
      const data = await res.json();
      if (data.error) {
        alert("Error generating index: " + data.error);
      } else {
        if (data.topics && data.topics.length > 0) {
          setIndexTopics(data.topics);
        } else {
          setMessages([{ role: 'assistant', content: `**AI Generated Index (Raw):**\n\n${data.raw}` }]);
        }
      }
    } catch (error) {
      console.error("Index generation error:", error);
      alert("Failed to generate index.");
    } finally {
      setIsGeneratingIndex(false);
    }
  };

  const extractSpecificPages = async (start: string, end: string, autoDownload: boolean = false) => {
    if (!selectedBook || !start || !end) return;
    setIsExtracting(true);
    setExtractedTopic(null);
    setMessages([]);

    try {
      const res = await fetch('/api/extract-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedBook,
          startPage: start,
          endPage: end
        })
      });
      const data = await res.json();
      
      if (data.error) {
        alert("Error: " + data.error + (data.details ? " | " + data.details : ""));
      } else {
        setExtractedTopic({ 
          query: `Pages ${start}-${end}`, 
          content: data.text,
          pdfBase64: data.pdfBase64 
        });
        setMessages([{ role: 'assistant', content: `I've read pages ${start} to ${end} from ${selectedBook}. Ask me anything about this section!` }]);
        
        if (autoDownload && data.pdfBase64) {
          const link = document.createElement('a');
          link.href = `data:application/pdf;base64,${data.pdfBase64}`;
          link.download = `${selectedBook}-extracted-${start}-${end}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    } catch (error) {
      console.error("Extraction error:", error);
      alert("Failed to extract pages.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExtractPages = async (e: React.FormEvent) => {
    e.preventDefault();
    extractSpecificPages(startPage, endPage);
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

  const handleDownloadExtract = () => {
    if (!extractedTopic || !extractedTopic.pdfBase64) return;
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${extractedTopic.pdfBase64}`;
    link.download = `${selectedBook}-extracted-${startPage}-${endPage}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-screen w-full bg-[#FAFAFA] font-sans overflow-hidden text-gray-900">
      
      {/* Sidebar: Library & Upload */}
      <div className={`
        fixed inset-y-0 left-0 z-30 w-72 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
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
          <p className="text-xs text-gray-400 text-center mt-3 font-medium">Or upload via SSH to /home/books</p>
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
          className="fixed inset-0 bg-black/20 z-20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main Content: PDF Viewer */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-100 relative">
        <div className="h-14 border-b border-gray-200 flex items-center justify-between px-4 bg-white shrink-0 shadow-sm z-10 relative">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Library className="w-5 h-5" />
            </button>
            <h2 className="font-medium text-gray-900 flex items-center gap-2 truncate max-w-[200px] sm:max-w-md">
              <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="truncate">{selectedBook || 'Reader'}</span>
            </h2>
          </div>
          
          {selectedBook && (
            <button
              onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                isAiSidebarOpen 
                  ? 'bg-blue-50 text-blue-700' 
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Bot className={`w-4 h-4 ${isAiSidebarOpen ? 'text-blue-600' : 'text-emerald-500'}`} />
              <span className="hidden sm:inline">Ask AI & Extract</span>
              {isAiSidebarOpen ? <PanelRightClose className="w-4 h-4 ml-1 opacity-50" /> : <PanelRightOpen className="w-4 h-4 ml-1 opacity-50" />}
            </button>
          )}
        </div>
        
        <div className="flex-1 overflow-hidden relative bg-gray-200/50">
          {selectedBook ? (
            <div className="h-full w-full">
              <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js">
                <Viewer
                  fileUrl={`/api/books/${selectedBook}`}
                  plugins={[defaultLayoutPluginInstance]}
                  onDocumentLoad={handleDocumentLoad}
                  onPageChange={handlePageChange}
                />
              </Worker>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
              <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center border border-gray-200 shadow-sm">
                <FileText className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-gray-800 font-medium text-lg">No book selected</h3>
              <p className="text-sm text-gray-500 max-w-sm text-center">
                Select a book from the library on the left, or upload a new PDF to start reading. The native browser viewer will show the index/outline automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* AI Extract & Chat Sidebar */}
      {isAiSidebarOpen && (
        <div className="w-full md:w-[420px] lg:w-[480px] bg-white border-l border-gray-200 flex flex-col h-full shrink-0 shadow-[-4px_0_24px_rgba(0,0,0,0.02)] absolute right-0 top-0 md:relative z-40">
          <div className="h-14 border-b border-gray-100 flex items-center px-4 justify-between bg-white shrink-0">
            <h2 className="font-medium text-gray-800 flex items-center gap-2">
              <Bot className="w-5 h-5 text-emerald-500" />
              AI Assistant
            </h2>
            <div className="flex items-center gap-2">
              <button 
                className="md:hidden p-2 text-gray-400 hover:text-gray-800"
                onClick={() => setIsAiSidebarOpen(false)}
              >
                <PanelRightClose className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Extract Topic by Pages</h3>
              {currentPage > 0 && (
                <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">
                  Current: p. {currentPage}
                </span>
              )}
            </div>
            <form onSubmit={handleExtractPages} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-500 block">Start Page</label>
                    <button type="button" onClick={() => setStartPage(currentPage.toString())} className="text-[10px] text-blue-600 hover:underline">Use Current</button>
                  </div>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 15"
                    value={startPage}
                    onChange={(e) => setStartPage(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-500 block">End Page</label>
                    <button type="button" onClick={() => setEndPage(currentPage.toString())} className="text-[10px] text-blue-600 hover:underline">Use Current</button>
                  </div>
                  <input
                    type="number"
                    min={startPage || "1"}
                    placeholder="e.g. 20"
                    value={endPage}
                    onChange={(e) => setEndPage(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!startPage || !endPage || isExtracting}
                className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Extract Pages for Chat
              </button>
            </form>
            
            {extractedTopic && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-between">
                <div className="text-xs text-emerald-800">
                  <span className="font-semibold block mb-0.5">Extraction Ready</span>
                  Pages {startPage} - {endPage} loaded for AI.
                </div>
                <button
                  onClick={handleDownloadExtract}
                  className="p-2 bg-white text-emerald-600 rounded-md shadow-sm border border-emerald-100 hover:bg-emerald-50 transition-colors"
                  title="Download Extracted PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t border-gray-200">
              {isParsingIndex ? (
                 <div className="w-full py-2 flex items-center justify-center gap-2 text-xs text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Parsing PDF outline...
                 </div>
              ) : !hasNativeIndex ? (
                <button
                  onClick={handleGenerateIndex}
                  disabled={isGeneratingIndex}
                  className="w-full py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 mb-2"
                >
                  {isGeneratingIndex ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                  Generate AI Index for entire book
                </button>
              ) : null}
              
              {indexTopics.length > 0 && (
                <div className="mt-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                   <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Click topic to load pages</h4>
                   <div className="space-y-1">
                      {indexTopics.map((topic, i) => (
                         <button 
                            key={i} 
                            onClick={() => {
                               const s = topic.startPage.toString();
                               const e = topic.endPage ? topic.endPage.toString() : (topic.startPage + 10).toString();
                               setStartPage(s);
                               setEndPage(e);
                               extractSpecificPages(s, e, true);
                            }}
                            className="w-full text-left py-2 px-3 hover:bg-white rounded-lg text-sm text-gray-700 flex justify-between items-center group border border-transparent hover:border-gray-200 transition-colors"
                         >
                            <span className="truncate pr-2 font-medium">{topic.title}</span>
                            <span className="text-xs text-gray-400 group-hover:text-blue-500 whitespace-nowrap bg-gray-100 group-hover:bg-blue-50 px-1.5 py-0.5 rounded-md">
                              p. {topic.startPage}{topic.endPage && topic.endPage > topic.startPage ? `-${topic.endPage}` : ''}
                            </span>
                         </button>
                      ))}
                   </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chat</div>
              <div className="flex items-center gap-1.5 text-xs">
                <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-transparent text-gray-500 outline-none cursor-pointer focus:ring-0 max-w-[120px] truncate"
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center px-4 text-gray-400 gap-3">
                <MessageSquare className="w-8 h-8 text-gray-300 mb-1" />
                <p className="text-sm">Extract pages above to start chatting with the AI about them.</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-gray-900 text-white rounded-br-sm shadow-sm' 
                        : 'bg-gray-50 text-gray-800 border border-gray-200/60 rounded-bl-sm shadow-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="markdown-body prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-white prose-pre:border prose-pre:border-gray-200">
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
                <div className="bg-gray-50 border border-gray-200/60 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white border-t border-gray-100 shrink-0 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
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
                placeholder={extractedTopic ? `Ask about pages ${startPage}-${endPage}...` : "Extract pages first"}
                disabled={!extractedTopic || isChatting}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none max-h-32 disabled:opacity-50 disabled:bg-gray-50"
                rows={1}
                style={{
                  minHeight: '46px',
                  height: inputMessage.split('\n').length > 1 ? `${Math.min(inputMessage.split('\n').length * 24 + 24, 128)}px` : '46px'
                }}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || !extractedTopic || isChatting}
                className="absolute right-2 bottom-1.5 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

// Setup books directory for SSH uploads and web uploads
const booksDir = path.join(process.cwd(), 'books');
if (!fs.existsSync(booksDir)) {
  fs.mkdirSync(booksDir, { recursive: true });
}

// Configure multer to save files to the books directory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, booksDir)
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
});
const upload = multer({ storage: storage });

// Cache for parsed books to avoid re-parsing
const parsedBooks: Record<string, string> = {};

async function getBookText(filename: string): Promise<string> {
  if (parsedBooks[filename]) return parsedBooks[filename];
  const filePath = path.join(booksDir, filename);
  if (!fs.existsSync(filePath)) throw new Error("Book not found");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  parsedBooks[filename] = data.text;
  return data.text;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/models", async (req, res) => {
    res.json({
      models: [
        { id: "meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B Instruct" },
        { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
        { id: "mistralai/mixtral-8x22b-instruct-v0.1", name: "Mixtral 8x22B" },
        { id: "nvidia/nemotron-4-340b-instruct", name: "Nemotron-4 340B" },
        { id: "google/gemma-2-27b-it", name: "Gemma 2 27B IT" },
        { id: "microsoft/phi-3-medium-4k-instruct", name: "Phi-3 Medium (4k)" }
      ]
    });
  });

  app.get("/api/books", (req, res) => {
    try {
      const files = fs.readdirSync(booksDir).filter(f => f.toLowerCase().endsWith('.pdf'));
      res.json({ books: files });
    } catch(e: any) {
      res.status(500).json({ error: "Failed to read books directory", details: e.message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      res.json({ success: true, filename: req.file.filename });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload file", details: error.message });
    }
  });

  app.post("/api/extract-topic", async (req, res) => {
    try {
      const { filename, topic } = req.body;
      if (!filename || !topic) {
        return res.status(400).json({ error: "Missing filename or topic" });
      }

      const fullText = await getBookText(filename);
      
      const paragraphs = fullText.split(/\n\s*\n/);
      const keywords = topic.toLowerCase().split(' ').filter((k: string) => k.length > 2);
      if (keywords.length === 0) keywords.push(topic.toLowerCase());

      const scoredParagraphs = paragraphs.map((p: string, index: number) => {
        const lowerP = p.toLowerCase();
        let score = 0;
        keywords.forEach((k: string) => {
          if (lowerP.includes(k)) score++;
        });
        return { p, index, score };
      });

      scoredParagraphs.sort((a: any, b: any) => b.score - a.score);
      
      // Top 20 relevant paragraphs
      const topMatches = scoredParagraphs.filter((sp: any) => sp.score > 0).slice(0, 20);
      
      if (topMatches.length === 0) {
        return res.json({ topicContent: "No relevant sections found for this topic in the book. Try different keywords." });
      }

      topMatches.sort((a: any, b: any) => a.index - b.index);

      let topicContent = "";
      topMatches.forEach((match: any) => {
        topicContent += `[...] ${match.p.trim()} [...]\n\n`;
      });

      res.json({ topicContent });
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: "Failed to extract topic", details: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { topicContent, messages, model, filename, topic } = req.body;
      const apiKey = process.env.NVIDIA_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "NVIDIA_API_KEY is not configured on the server. Please add it to your environment variables." });
      }

      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://integrate.api.nvidia.com/v1",
      });

      const systemPrompt = `You are an expert reading assistant and tutor. The user is currently reading about the topic "${topic}" from the book "${filename}".
Here are the relevant excerpts extracted from the book:

<book_excerpts>
${topicContent}
</book_excerpts>

Answer the user's questions based primarily on these excerpts. If they ask a general question, you can answer it, but always try to connect it back to the text if relevant. Keep responses concise and helpful.`;

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role, content: m.content }))
      ];

      const response = await openai.chat.completions.create({
        model: model || "meta/llama-3.1-8b-instruct",
        messages: apiMessages,
        max_tokens: 1024,
        temperature: 0.5,
      });

      res.json({ reply: response.choices[0].message.content });
    } catch (error: any) {
      console.error("Chat API error:", error);
      res.status(500).json({ error: "Failed to communicate with AI", details: error.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

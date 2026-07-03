import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createRequire } from "module";
import { PDFDocument } from "pdf-lib";

// @ts-ignore
const _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);
const pdfParse = _require("pdf-parse");

// Setup books directory for SSH uploads and web uploads
const booksDir = '/home/books';
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
    try {
      const apiKey = process.env.NVIDIA_API_KEY;
      if (apiKey) {
        const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (response.ok) {
          const data = await response.json();
          let models = data.data.map((m: any) => {
             const parts = m.id.split('/');
             const name = parts.length > 1 ? parts[1].split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : m.id;
             return { id: m.id, name: name + ` (${parts[0] || m.owned_by})` };
          });
          models.sort((a: any, b: any) => a.name.localeCompare(b.name));
          return res.json({ models });
        }
      }
    } catch (e) {
      console.error("Failed to fetch models dynamically:", e);
    }

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

  app.get("/api/books/:filename", (req, res) => {
    try {
      const filePath = path.join(booksDir, req.params.filename);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("File not found");
      }
    } catch (e: any) {
      res.status(500).send("Error");
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

  app.post("/api/generate-index", async (req, res) => {
    try {
      const { filename, modelId, startPage, endPage } = req.body;
      if (!filename || !modelId || !startPage || !endPage) return res.status(400).json({ error: "Missing filename, modelId, startPage, or endPage" });
      
      const filePath = path.join(booksDir, filename);
      if (!fs.existsSync(filePath)) throw new Error("Book not found");
      const buffer = fs.readFileSync(filePath);
      
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const newPdf = await PDFDocument.create();
      
      const start = parseInt(startPage);
      const end = parseInt(endPage);

      const pageIndices = [];
      for (let i = start - 1; i <= end - 1; i++) {
        if (i >= 0 && i < pdfDoc.getPageCount()) {
           pageIndices.push(i);
        }
      }

      if (pageIndices.length === 0) throw new Error("Invalid page range");

      const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach((page) => newPdf.addPage(page));
      
      const newPdfBytes = await newPdf.save();
      const newPdfBuffer = Buffer.from(newPdfBytes);

      const data = await pdfParse(newPdfBuffer);
      let text = data.text;
      
      const prompt = `Extract a Table of Contents (Index) from the following text (which is the table of contents pages of a book). 
Return ONLY a JSON array of objects, where each object has a 'title' (string), a 'startPage' (number), and an 'endPage' (number). If the end page is unknown, estimate it based on the next topic's start page. Do not include any markdown formatting around the JSON array, just the raw JSON array.

Text:
${text.substring(0, 15000)}`;
      
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to generate AI response");
      }

      const aiData = await response.json();
      let content = aiData.choices[0].message.content;
      // Strip markdown code block if present
      content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
      let topics = [];
      try {
        topics = JSON.parse(content);
      } catch (e) {
        console.error("JSON parse error:", e);
      }
      res.json({ topics, raw: content });
    } catch (error: any) {
      console.error("Index generation error:", error);
      res.status(500).json({ error: "Failed to generate index", details: error.message });
    }
  });

  app.post("/api/extract-pages", async (req, res) => {
    try {
      console.log("CWD IS: ", process.cwd());
      const { filename, startPage, endPage } = req.body;
      console.log("EXTRACT PARAMS:", filename, startPage, endPage);
      if (!filename || startPage == null || endPage == null) {
        return res.status(400).json({ error: "Missing filename, startPage, or endPage" });
      }

      const filePath = path.join(booksDir, filename);
      if (!fs.existsSync(filePath)) throw new Error("Book not found");
      const buffer = fs.readFileSync(filePath);
      
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const newPdf = await PDFDocument.create();
      
      const start = parseInt(startPage);
      const end = parseInt(endPage);

      const pageIndices = [];
      for (let i = start - 1; i <= end - 1; i++) {
        if (i >= 0 && i < pdfDoc.getPageCount()) {
           pageIndices.push(i);
        }
      }

      if (pageIndices.length === 0) {
        return res.status(400).json({ error: "Invalid page range" });
      }

      const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach((page) => newPdf.addPage(page));

      console.log("Saving new pdf");
      const newPdfBytes = await newPdf.save();
      const newPdfBuffer = Buffer.from(newPdfBytes);
      
      console.log("Parsing pdf text using pdf-parse");
      const data = await pdfParse(newPdfBuffer);
      console.log("Parse complete");
      const base64Pdf = newPdfBuffer.toString('base64');
      
      res.json({ text: data.text, pdfBase64: base64Pdf });
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: "Failed to extract pages", details: error.message });
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

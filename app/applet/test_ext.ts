import fs from "fs";
import { PDFDocument } from "pdf-lib";
import { createRequire } from "module";

const _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);
const pdfParse = _require("pdf-parse");

async function test() {
  try {
    const filePath = "/home/books/nelson text book 22 full.pdf";
    if (!fs.existsSync(filePath)) {
       console.log("No file");
       return;
    }
    const buffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdfDoc, [57]);
    copiedPages.forEach((page) => newPdf.addPage(page));
    const newPdfBytes = await newPdf.save();
    const newPdfBuffer = Buffer.from(newPdfBytes);
    const data = await pdfParse(newPdfBuffer);
    console.log(data.text.substring(0, 100));
  } catch (e) {
    console.error("ERROR", e);
  }
}
test();

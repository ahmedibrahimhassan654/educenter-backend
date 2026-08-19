import { getDocument, GlobalWorkerOptions, VerbosityLevel } from "pdfjs-dist";

// Suppress non-error warnings from pdfjs-dist (e.g. canvas / DOMMatrix / Path2D
// polyfill warnings). We only need text extraction, not canvas rendering, so
// the optional "canvas" dependency is not required.
// setVerbosityLevel is exported at runtime but not in the TS type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsMod = require("pdfjs-dist");
pdfjsMod.setVerbosityLevel?.(VerbosityLevel.ERRORS);

const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export function isAllowedDocumentType(mimetype: string): boolean {
  return mimetype in ALLOWED_DOCUMENT_TYPES;
}

export function getFileExtension(mimetype: string): string | null {
  return ALLOWED_DOCUMENT_TYPES[mimetype] || null;
}

export interface ParsedContent {
  text: string;
  pageCount?: number;
  fileType: string;
}

export async function parsePdf(buffer: Buffer): Promise<ParsedContent> {
  GlobalWorkerOptions.workerSrc = "";

  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    pages.push(pageText);
  }

  return {
    text: pages.join("\n").trim(),
    pageCount: doc.numPages,
    fileType: "pdf",
  };
}

export async function parseImage(buffer: Buffer): Promise<ParsedContent> {
  return {
    text: "[صورة - لم يتم استخراج النص بعد]",
    fileType: "image",
  };
}

export async function parseDocument(
  buffer: Buffer,
  mimetype: string
): Promise<ParsedContent> {
  if (mimetype === "application/pdf") {
    return parsePdf(buffer);
  }

  if (mimetype.startsWith("image/")) {
    return parseImage(buffer);
  }

  if (mimetype === "text/plain" || mimetype === "text/markdown") {
    return {
      text: buffer.toString("utf-8"),
      fileType: mimetype === "text/markdown" ? "markdown" : "text",
    };
  }

  throw new Error(`Unsupported document type for parsing: ${mimetype}`);
}

export function chunkText(text: string, maxChunkSize: number = 8000): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/([.!?؟。]\s+)/);
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

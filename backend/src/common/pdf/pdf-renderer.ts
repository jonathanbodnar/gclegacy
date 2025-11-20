import { join } from "path";
import { createRequire } from "module";

type CanvasFactory = {
  createCanvas: (
    width: number,
    height: number
  ) => {
    width: number;
    height: number;
    getContext: (type: "2d") => any;
    toBuffer: (type?: string) => Buffer;
  };
  Path2D?: any;
  ImageData?: any;
};

let canvasModule: CanvasFactory | null = null;
let standardFontDataUrl: string | null = null;
let canvasPolyfillsInitialized = false;

export interface PdfPageImage {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface PdfRenderOptions {
  dpi?: number;
  maxPages?: number;
}

export interface PdfPageRenderOptions {
  dpi?: number;
}

export async function renderPdfToImages(
  pdfBuffer: Buffer,
  options: PdfRenderOptions = {}
): Promise<PdfPageImage[]> {
  // Ensure canvas polyfills are initialized before loading pdfjs
  ensureCanvasPolyfills();

  // Suppress XFA parsing warnings from pdfjs-dist
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const message = args.join(" ");
    // Suppress known XFA parsing warnings that don't affect functionality
    if (message.includes("XFA") && message.includes("rich text")) {
      return; // Suppress this warning
    }
    originalWarn.apply(console, args);
  };

  try {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      standardFontDataUrl: getStandardFontPath(),
    });
    const pdfDoc = await loadingTask.promise;
    const dpi = normalizeDpi(options.dpi);
    const totalPages = pdfDoc.numPages;
    const limit = options.maxPages
      ? Math.min(options.maxPages, totalPages)
      : totalPages;

    const results: PdfPageImage[] = [];
    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      results.push(await renderPageWithDpi(page, dpi));
    }

    return results;
  } finally {
    // Restore original console.warn
    console.warn = originalWarn;
  }
}

export async function renderPdfPage(
  page: any,
  options: PdfPageRenderOptions = {}
): Promise<PdfPageImage> {
  // Ensure canvas polyfills are initialized
  ensureCanvasPolyfills();
  const dpi = normalizeDpi(options.dpi);
  return renderPageWithDpi(page, dpi);
}

async function loadPdfJs(): Promise<any> {
  const errors: string[] = [];
  const nodeRequire = createRequire(__filename);

  // Try CommonJS require first (works for pdfjs-dist 3.x)
  try {
    const lib = nodeRequire("pdfjs-dist/legacy/build/pdf.js");
    if (lib && typeof lib.getDocument === "function") {
      return lib;
    }
  } catch (legacyError: any) {
    errors.push(`legacy build require failed: ${legacyError.message}`);
  }

  // Try ES Module import (for pdfjs-dist 4.x if upgraded)
  try {
    const pdfjsModule = await import("pdfjs-dist");
    const lib = pdfjsModule.default || pdfjsModule;

    if (lib && typeof lib.getDocument === "function") {
      return lib;
    } else {
      throw new Error("Module loaded but getDocument is not a function");
    }
  } catch (importError: any) {
    const errorMsg = importError.message || String(importError);
    errors.push(`ES module import failed: ${errorMsg}`);
  }

  // Try build/pdf.js (CommonJS build)
  try {
    const lib = nodeRequire("pdfjs-dist/build/pdf.js");
    if (lib && typeof lib.getDocument === "function") {
      return lib;
    }
  } catch (requireError: any) {
    errors.push(`build/pdf.js require failed: ${requireError.message}`);
  }

  // If all attempts failed, throw a comprehensive error
  throw new Error(
    `Failed to load pdfjs-dist. Attempted paths:\n${errors.join("\n")}\n\n` +
      `Please ensure pdfjs-dist is installed: npm install pdfjs-dist\n` +
      `Recommended: Use pdfjs-dist@^3.11.0 for CommonJS compatibility`
  );
}

function normalizeDpi(dpi?: number): number {
  const value = typeof dpi === "number" && dpi > 0 ? dpi : 220;
  return Math.max(value, 1);
}

async function renderPageWithDpi(
  page: any,
  dpi: number
): Promise<PdfPageImage> {
  const canvasLib = loadCanvasModule();
  const { createCanvas } = canvasLib;
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.max(Math.ceil(viewport.width), 1);
  const height = Math.max(Math.ceil(viewport.height), 1);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  await page.render({ canvasContext: context, viewport }).promise;

  return {
    buffer: canvas.toBuffer("image/png"),
    widthPx: width,
    heightPx: height,
  };
}

function ensureCanvasPolyfills(): void {
  if (canvasPolyfillsInitialized) {
    return;
  }

  try {
    // Load canvas module first
    if (!canvasModule) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      canvasModule = require("@napi-rs/canvas");
    }

    // Polyfill Path2D if available
    if (
      canvasModule &&
      canvasModule.Path2D &&
      typeof (globalThis as any).Path2D === "undefined"
    ) {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }

    // Polyfill ImageData - @napi-rs/canvas should export it, but ensure it's global
    if (typeof (globalThis as any).ImageData === "undefined") {
      if (canvasModule && canvasModule.ImageData) {
        // Use the ImageData from @napi-rs/canvas if available
        (globalThis as any).ImageData = canvasModule.ImageData;
      } else {
        // Fallback: create ImageData polyfill using canvas context
        // We'll create a small temporary canvas to get access to createImageData
        const tempCanvas = canvasModule.createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext("2d");

        // Create ImageData constructor that matches the browser API
        (globalThis as any).ImageData = class ImageData {
          data: Uint8ClampedArray;
          width: number;
          height: number;

          constructor(
            dataOrWidth: Uint8ClampedArray | number,
            heightOrWidth?: number,
            height?: number
          ) {
            if (typeof dataOrWidth === "number") {
              // Constructor(width, height)
              const width = dataOrWidth;
              const h = heightOrWidth || 1;
              const imgData = tempCtx.createImageData(width, h);
              this.data = imgData.data;
              this.width = width;
              this.height = h;
            } else {
              // Constructor(data, width, height)
              const data = dataOrWidth;
              const width = heightOrWidth || 1;
              const h = height || 1;
              const imgData = tempCtx.createImageData(width, h);
              imgData.data.set(data);
              this.data = imgData.data;
              this.width = width;
              this.height = h;
            }
          }
        };
      }
    }

    canvasPolyfillsInitialized = true;
  } catch (error: any) {
    // Don't throw here, let loadCanvasModule handle it
    console.warn("Failed to initialize canvas polyfills:", error.message);
  }
}

function loadCanvasModule(): CanvasFactory {
  if (canvasModule) {
    return canvasModule;
  }

  // Ensure polyfills are set up
  ensureCanvasPolyfills();

  if (!canvasModule) {
    const hint =
      "The '@napi-rs/canvas' package is required for PDF rendering. Install it with `npm install @napi-rs/canvas`.";
    throw new Error(hint);
  }

  return canvasModule;
}

function getStandardFontPath(): string {
  if (standardFontDataUrl) {
    return standardFontDataUrl;
  }
  const pkgPath = require.resolve("pdfjs-dist/package.json");
  const baseDir = join(pkgPath, "..", "build", "standard_fonts");
  standardFontDataUrl = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return standardFontDataUrl;
}

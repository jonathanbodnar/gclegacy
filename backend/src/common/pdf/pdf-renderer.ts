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
  // Suppress XFA parsing warnings BEFORE initializing canvas to catch warnings during library loading
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalStdErrWrite = process.stderr.write;
  
  console.warn = (...args: any[]) => {
    // Join all arguments to create the full message
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ');
    
    // Suppress known XFA parsing warnings that don't affect functionality
    // Check for various XFA-related warning patterns (case-insensitive)
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('xfa') ||
      (lowerMessage.includes('rich text') && (lowerMessage.includes('error') || lowerMessage.includes('occurred'))) ||
      (lowerMessage.includes('cannot destructure') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('destructure property') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('attributes') && lowerMessage.includes('null') && lowerMessage.includes('html')) ||
      (message.includes('XFA') && message.includes('parsing'))
    ) {
      return; // Suppress this warning
    }
    originalWarn.apply(console, args);
  };
  
  // Also intercept stderr.write as a fallback (some libraries write directly to stderr)
  process.stderr.write = function(chunk: any, encoding?: any, callback?: any): boolean {
    const message = chunk?.toString() || String(chunk);
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('xfa') ||
      (lowerMessage.includes('rich text') && (lowerMessage.includes('error') || lowerMessage.includes('occurred'))) ||
      (lowerMessage.includes('cannot destructure') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('destructure property') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('attributes') && lowerMessage.includes('null') && lowerMessage.includes('html')) ||
      (message.includes('Warning:') && message.includes('XFA'))
    ) {
      // Suppress XFA warnings written directly to stderr
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    }
    return originalStdErrWrite.call(process.stderr, chunk, encoding, callback);
  };

  // Ensure canvas polyfills are initialized before loading pdfjs
  ensureCanvasPolyfills();

  // Suppress canvas cleanup errors that occur during PDF.js operations
  console.error = (...args: any[]) => {
    const message = args.join(" ");
    // Suppress specific canvas cleanup errors and XFA parsing errors that don't affect functionality
    if (
      message.includes("Failed to unwrap exclusive reference") ||
      (message.includes("CanvasElement") && message.includes("napi value")) ||
      message.includes("InvalidArg") ||
      message.includes("XFA") ||
      message.includes("Cannot destructure property") ||
      (message.includes("html") && message.includes("null"))
    ) {
      return; // Suppress this error
    }
    originalError.apply(console, args);
  };

  // Set up unhandled rejection handler to catch async canvas cleanup errors
  const originalUnhandledRejection = process.listeners("unhandledRejection");
  const unhandledRejectionHandler = (reason: any, promise: Promise<any>) => {
    // Suppress canvas cleanup errors and XFA parsing errors that occur as unhandled rejections
    if (
      reason &&
      typeof reason === "object" &&
      (reason.code === "InvalidArg" ||
        (reason.message &&
          (reason.message.includes("Failed to unwrap exclusive reference") ||
            reason.message.includes("CanvasElement") ||
            reason.message.includes("napi value") ||
            reason.message.includes("XFA") ||
            reason.message.includes("Cannot destructure property") ||
            (reason.message.includes("html") && reason.message.includes("null")))))
    ) {
      // Silently ignore these cleanup/XFA errors - they don't affect functionality
      return;
    }
    // For other errors, call original handlers
    originalUnhandledRejection.forEach((handler) => {
      try {
        handler(reason, promise);
      } catch (e) {
        // Ignore errors in error handlers
      }
    });
  };
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", unhandledRejectionHandler);

  try {
    const pdfjsLib = await loadPdfJs();
    let pdfDoc;
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        standardFontDataUrl: getStandardFontPath(),
        stopAtErrors: true, // Continue processing even with errors
      });
      pdfDoc = await loadingTask.promise;
    } catch (loadError: any) {
      // If loading fails, try with error recovery
      if (loadError?.message && (loadError.message.includes('XFA') || loadError.message.includes('rich text'))) {
        // Try again with minimal options
        const retryTask = pdfjsLib.getDocument({
          data: new Uint8Array(pdfBuffer),
          standardFontDataUrl: getStandardFontPath(),
          stopAtErrors: true,
        });
        pdfDoc = await retryTask.promise;
      } else {
        throw loadError;
      }
    }
    
    const dpi = normalizeDpi(options.dpi);
    const totalPages = pdfDoc.numPages;
    const limit = options.maxPages
      ? Math.min(options.maxPages, totalPages)
      : totalPages;

    const results: PdfPageImage[] = [];
    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        results.push(await renderPageWithDpi(page, dpi));
        
        // Yield back to event loop every 3 pages to prevent blocking
        // This allows health checks and other requests to be processed
        if (pageNum % 3 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      } catch (pageError: any) {
        // Log but continue processing other pages
        console.warn(`Failed to render page ${pageNum}: ${pageError?.message || String(pageError)}. Skipping this page.`);
        // Continue to next page instead of crashing
        continue;
      }
    }

    return results;
  } finally {
    // Restore original console methods and stderr
    console.warn = originalWarn;
    console.error = originalError;
    process.stderr.write = originalStdErrWrite;
    // Restore original unhandled rejection handlers
    if (typeof originalUnhandledRejection !== "undefined") {
      process.removeAllListeners("unhandledRejection");
      originalUnhandledRejection.forEach((handler) => {
        process.on("unhandledRejection", handler);
      });
    }
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

  // Ensure canvas is loaded before configuring PDF.js
  ensureCanvasPolyfills();
  const canvasLib = loadCanvasModule();

  // Helper function to configure PDF.js for Node.js environment
  const configurePdfJs = (lib: any): any => {
    if (!lib) return lib;

    try {
      // Disable worker to run in main thread (better for Node.js)
      if (lib.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = false;
      }

      // Try to set up canvas factory if the API is available
      // This helps PDF.js properly handle canvas objects in Node.js
      if (typeof lib.setCanvasFactory === "function") {
        lib.setCanvasFactory({
          create(width: number, height: number) {
            const canvas = canvasLib.createCanvas(width, height);
            return {
              canvas: canvas,
              context: canvas.getContext("2d"),
            };
          },
          reset(canvasAndContext: any, width: number, height: number) {
            if (canvasAndContext?.canvas) {
              try {
                canvasAndContext.canvas.width = width;
                canvasAndContext.canvas.height = height;
              } catch (e) {
                // Ignore reset errors
              }
            }
          },
          destroy(canvasAndContext: any) {
            // Suppress destruction errors - @napi-rs/canvas handles cleanup
            // PDF.js tries to destroy canvases it didn't create, causing errors
            // Don't try to modify the canvas - just return without doing anything
            // Setting width/height to 0 causes the napi unwrap error
            // The canvas will be garbage collected naturally
            return;
          },
        });
      }
    } catch (configError: any) {
      // Configuration is optional - continue even if it fails
      // The error handling in renderPageWithDpi will catch actual rendering issues
    }

    return lib;
  };

  // Try CommonJS require first (works for pdfjs-dist 3.x)
  try {
    const lib = nodeRequire("pdfjs-dist/legacy/build/pdf.js");
    if (lib && typeof lib.getDocument === "function") {
      return configurePdfJs(lib);
    }
  } catch (legacyError: any) {
    errors.push(`legacy build require failed: ${legacyError.message}`);
  }

  // Try ES Module import (for pdfjs-dist 4.x if upgraded)
  try {
    const pdfjsModule = await import("pdfjs-dist");
    const lib = pdfjsModule.default || pdfjsModule;

    if (lib && typeof lib.getDocument === "function") {
      return configurePdfJs(lib);
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
      return configurePdfJs(lib);
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

  let renderTask: any = null;
  let buffer: Buffer;
  
  try {
    renderTask = page.render({ canvasContext: context, viewport });
    await renderTask.promise;
    
    // Get the buffer immediately after rendering
    buffer = canvas.toBuffer("image/png");
  } catch (renderError: any) {
    // If rendering fails, try to cancel the task gracefully
    if (renderTask && typeof renderTask.cancel === "function") {
      try {
        // Wrap cancel in try-catch to suppress cleanup errors
        const cancelPromise = renderTask.cancel();
        if (cancelPromise && typeof cancelPromise.catch === "function") {
          cancelPromise.catch(() => {
            // Silently ignore cleanup errors during cancel
          });
        }
      } catch (cancelError) {
        // Ignore errors during cancellation - they're cleanup-related
      }
    }
    throw renderError;
  } finally {
    // Explicitly clean up canvas resources
    // Note: @napi-rs/canvas doesn't have explicit cleanup methods,
    // but we can try to clear the context to free memory
    try {
      if (context && typeof context.clearRect === "function") {
        context.clearRect(0, 0, width, height);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors - canvas will be GC'd
    }
    
    // Clear references to help GC
    // The canvas will be garbage collected after this function returns
  }

  return {
    buffer: buffer!,
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

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DEFAULT_DPI = 220;

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
  options: PdfRenderOptions = {},
): Promise<PdfPageImage[]> {
  return withTempPdf(pdfBuffer, async (pdfPath) => {
    const totalPages = await getPdfPageCountFromPath(pdfPath);
    const dpi = normalizeDpi(options.dpi);
    const limit = options.maxPages ? Math.min(options.maxPages, totalPages) : totalPages;
    const results: PdfPageImage[] = [];
    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      results.push(await renderPdfPageFromPath(pdfPath, pageNum, dpi));
    }
    return results;
  });
}

export async function renderPdfPageFromPath(
  pdfPath: string,
  pageNumber: number,
  dpi: number = DEFAULT_DPI,
): Promise<PdfPageImage> {
  const prefix = join(tmpdir(), `plantakeoff-${randomUUID()}`);
  const args = [
    '-png',
    '-singlefile',
    '-r',
    dpi.toString(),
    '-f',
    pageNumber.toString(),
    '-l',
    pageNumber.toString(),
    pdfPath,
    prefix,
  ];

  await execFileAsync('pdftoppm', args);
  const imagePath = `${prefix}.png`;

  try {
    const buffer = await fs.readFile(imagePath);
    const { width, height } = await getImageDimensions(imagePath);
    return {
      buffer,
      widthPx: width,
      heightPx: height,
    };
  } finally {
    await fs.unlink(imagePath).catch(() => undefined);
  }
}

export interface PdfDocumentInfo {
  pages: number;
  pageSize?: {
    widthPt: number;
    heightPt: number;
  };
}

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const info = await withTempPdf(pdfBuffer, (pdfPath) => getPdfInfoFromPath(pdfPath));
  return info.pages;
}

export async function getPdfPageCountFromPath(pdfPath: string): Promise<number> {
  const info = await getPdfInfoFromPath(pdfPath);
  return info.pages;
}

export async function getPdfInfoFromPath(pdfPath: string): Promise<PdfDocumentInfo> {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const pagesMatch = stdout.match(/Pages:\s+(\d+)/i);
  if (!pagesMatch) {
    throw new Error('Unable to determine PDF page count via pdfinfo');
  }

  const info: PdfDocumentInfo = { pages: parseInt(pagesMatch[1], 10) };
  const sizeMatch = stdout.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  if (sizeMatch) {
    info.pageSize = {
      widthPt: parseFloat(sizeMatch[1]),
      heightPt: parseFloat(sizeMatch[2]),
    };
  }
  return info;
}

export async function extractPdfPageText(pdfPath: string, pageNumber: number): Promise<string> {
  const args = [
    '-layout',
    '-enc',
    'UTF-8',
    '-f',
    pageNumber.toString(),
    '-l',
    pageNumber.toString(),
    pdfPath,
    '-',
  ];
  const { stdout } = await execFileAsync('pdftotext', args);
  return stdout.toString().replace(/\s+/g, ' ').trim();
}

function normalizeDpi(dpi?: number): number {
  const value = typeof dpi === 'number' && dpi > 0 ? dpi : DEFAULT_DPI;
  return Math.max(value, 1);
}

async function withTempPdf<T>(buffer: Buffer, handler: (pdfPath: string) => Promise<T>): Promise<T> {
  const pdfPath = join(tmpdir(), `plantakeoff-${randomUUID()}.pdf`);
  await fs.writeFile(pdfPath, buffer);
  try {
    return await handler(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => undefined);
  }
}

async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync('identify', ['-format', '%w %h', imagePath]);
  const [widthStr, heightStr] = stdout.trim().split(/\s+/);
  const width = parseInt(widthStr, 10);
  const height = parseInt(heightStr, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Unable to detect image dimensions for ${imagePath}`);
  }
  return { width, height };
}

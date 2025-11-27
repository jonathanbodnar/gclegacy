import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { createCanvas } from '@napi-rs/canvas';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'build',
  'pdf.worker.js',
);

export interface RenderedPage {
  pageIndex: number;
  width: number;
  height: number;
  buffer: Buffer;
}

export const renderPdfToImages = async (
  pdfBuffer: Buffer,
  maxPages: number,
  scale = 1.3,
): Promise<RenderedPage[]> => {
  const pdfData = Buffer.isBuffer(pdfBuffer)
    ? new Uint8Array(pdfBuffer)
    : pdfBuffer;

  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDocument = await loadingTask.promise;
  const totalPages = Math.min(pdfDocument.numPages, Math.max(1, maxPages));
  const rendered: RenderedPage[] = [];

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context as any,
      viewport,
      intent: 'print',
    }).promise;

    rendered.push({
      pageIndex: pageNumber - 1,
      width: viewport.width,
      height: viewport.height,
      buffer: canvas.toBuffer('image/png'),
    });
  }

  return rendered;
};


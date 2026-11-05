/**
 * The text of a PDF, read in the browser with pdf.js. Its worker is bundled with the extension (an MV3 page can't load
 * remote code); pdf.js 6 never uses eval. Lines are kept so a CSV pasted into a PDF reads back as rows.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfText(data: Uint8Array): Promise<string> {
  const task = getDocument({ data, useWorkerFetch: false });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push(text.trimEnd());
    }
    return pages.join('\n');
  } finally {
    await task.destroy();
  }
}

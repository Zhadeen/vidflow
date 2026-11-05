/**
 * A scene file uploaded in the side panel (spec §19): CSV, TSV or TXT read as text; PDF text read in the browser with
 * pdf.js (worker bundled with the extension). The text goes into the paste box; "Use these scenes" still applies it.
 */

export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const WRONG_TYPE_MESSAGE = 'Use a CSV, TSV, TXT or PDF file.';
export const NO_PDF_TEXT_MESSAGE = 'This PDF has no text VidFlow can read. Paste the scenes instead.';
const PDF_TOO_BIG = 'This PDF is over 20 MB. Paste the scenes instead.';
const PDF_UNREADABLE = "VidFlow couldn't read this PDF. Paste the scenes instead.";
const FILE_UNREADABLE = "VidFlow couldn't read this file. Try again.";

/** What the file picker offers. */
export const SCENE_FILE_ACCEPT = '.csv,.tsv,.txt,.pdf,text/csv,text/tab-separated-values,text/plain,application/pdf';

type Kind = 'csv' | 'tsv' | 'txt' | 'pdf';

/** By the name first (Macs often give .csv files no type, or a spreadsheet type), then by the type. */
function kindOf(file: File): Kind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'pdf') return ext;
  if (ext) return null;
  if (file.type === 'text/csv') return 'csv';
  if (file.type === 'text/tab-separated-values') return 'tsv';
  if (file.type === 'text/plain') return 'txt';
  if (file.type === 'application/pdf') return 'pdf';
  return null;
}

/** Tab-separated rows as the comma-separated rows the scene reader takes (every cell quoted). */
function tsvToCsv(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line === '' ? '' : line.split('\t').map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')))
    .join('\n');
}

export async function fileToText(file: File): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const kind = kindOf(file);
  if (!kind) return { ok: false, message: WRONG_TYPE_MESSAGE };
  if (kind !== 'pdf') {
    try {
      const text = await file.text();
      return { ok: true, text: kind === 'tsv' ? tsvToCsv(text) : text };
    } catch {
      return { ok: false, message: FILE_UNREADABLE };
    }
  }
  if (file.size > PDF_MAX_BYTES) return { ok: false, message: PDF_TOO_BIG };
  try {
    // pdf.js is loaded only when a PDF is picked.
    const { pdfText } = await import('./pdfText');
    const text = await pdfText(new Uint8Array(await file.arrayBuffer()));
    return text.trim() ? { ok: true, text } : { ok: false, message: NO_PDF_TEXT_MESSAGE };
  } catch {
    return { ok: false, message: PDF_UNREADABLE };
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfText = vi.fn(async (_data: Uint8Array) => '');
vi.mock('../../src/scenes/pdfText', () => ({ pdfText: (data: Uint8Array) => pdfText(data) }));

import { fileToText, NO_PDF_TEXT_MESSAGE, PDF_MAX_BYTES, WRONG_TYPE_MESSAGE } from '../../src/scenes/fileText';

afterEach(() => pdfText.mockReset());

const CSV = 'Slide,Timecode,Sentence\n"Slide 01","00:00 - 00:04","Hello."';

describe('fileToText', () => {
  it('reads a CSV or TXT file as text', async () => {
    expect(await fileToText(new File([CSV], 'scenes.csv', { type: 'text/csv' }))).toEqual({ ok: true, text: CSV });
    expect(await fileToText(new File([CSV], 'reply.txt', { type: 'text/plain' }))).toEqual({ ok: true, text: CSV });
    // Some Macs give .csv files no type at all: the name decides.
    expect(await fileToText(new File([CSV], 'SCENES.CSV'))).toEqual({ ok: true, text: CSV });
  });

  it('reads a TSV file as the CSV the scene reader expects', async () => {
    const tsv = 'Slide\tTimecode\tSentence\nSlide 01\t00:00 - 00:04\tShe said "hi", then left.';
    const result = await fileToText(new File([tsv], 'scenes.tsv', { type: 'text/tab-separated-values' }));
    expect(result).toEqual({
      ok: true,
      text: '"Slide","Timecode","Sentence"\n"Slide 01","00:00 - 00:04","She said ""hi"", then left."',
    });
  });

  it('reads a PDF through pdf.js', async () => {
    pdfText.mockResolvedValueOnce(CSV);
    const result = await fileToText(new File([new Uint8Array([37, 80, 68, 70])], 'scenes.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({ ok: true, text: CSV });
    expect(pdfText).toHaveBeenCalledTimes(1);
    expect(Array.from(pdfText.mock.calls[0]![0])).toEqual([37, 80, 68, 70]);
  });

  it('a scanned PDF (no text) gets the plain message', async () => {
    pdfText.mockResolvedValueOnce('  \n ');
    const result = await fileToText(new File([new Uint8Array([1])], 'scan.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({ ok: false, message: NO_PDF_TEXT_MESSAGE });
    expect(NO_PDF_TEXT_MESSAGE).toBe('This PDF has no text VidFlow can read. Paste the scenes instead.');
  });

  it('a PDF pdf.js cannot open gets a plain message', async () => {
    pdfText.mockRejectedValueOnce(new Error('Invalid PDF structure.'));
    const result = await fileToText(new File([new Uint8Array([1])], 'broken.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({ ok: false, message: "VidFlow couldn't read this PDF. Paste the scenes instead." });
  });

  it('a PDF over 20 MB is refused before it is read', async () => {
    expect(PDF_MAX_BYTES).toBe(20 * 1024 * 1024);
    const big = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: PDF_MAX_BYTES + 1 });
    expect(await fileToText(big)).toEqual({ ok: false, message: 'This PDF is over 20 MB. Paste the scenes instead.' });
    expect(pdfText).not.toHaveBeenCalled();
  });

  it('other files get "Use a CSV, TSV, TXT or PDF file."', async () => {
    expect(WRONG_TYPE_MESSAGE).toBe('Use a CSV, TSV, TXT or PDF file.');
    expect(await fileToText(new File(['x'], 'script.docx'))).toEqual({ ok: false, message: WRONG_TYPE_MESSAGE });
    expect(await fileToText(new File(['x'], 'hero.png', { type: 'image/png' }))).toEqual({ ok: false, message: WRONG_TYPE_MESSAGE });
  });
});

/**
 * A clip's length from its own file (spike S8): the movie header box (moov > mvhd) holds the timescale and the
 * duration. The service worker has no <video> element, so the bytes are read directly. Pure; null when the bytes
 * aren't an MP4 VidFlow can read.
 */
export function mp4Duration(data: Uint8Array | ArrayBuffer): number | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = findBox(view, 0, view.byteLength, 'moov');
  if (!moov) return null;
  const mvhd = findBox(view, moov.body, moov.end, 'mvhd');
  if (!mvhd) return null;
  const at = mvhd.body;
  if (at + 1 > mvhd.end) return null;
  const version = view.getUint8(at);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (at + 32 > mvhd.end) return null;
    timescale = view.getUint32(at + 20);
    const long = view.getBigUint64(at + 24);
    if (long === 0xffffffffffffffffn) return null; // all ones: the duration is unknown
    duration = Number(long);
  } else {
    if (at + 20 > mvhd.end) return null;
    timescale = view.getUint32(at + 12);
    duration = view.getUint32(at + 16);
    if (duration === 0xffffffff) return null; // all ones: the duration is unknown
  }
  if (timescale === 0 || !Number.isFinite(duration)) return null;
  return Math.round((duration / timescale) * 1000) / 1000;
}

interface Box {
  body: number;
  end: number;
}

/** The first box of `type` among the boxes between start and end (one level only). */
function findBox(view: DataView, start: number, end: number, type: string): Box | null {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const name = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let head = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      const large = view.getBigUint64(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      head = 16;
    } else if (size === 0) size = end - at; // to the end of the enclosing box (or file)
    if (size < head || at + size > end) return null; // malformed or cut off
    if (name === type) return { body: at + head, end: at + size };
    at += size;
  }
  return null;
}

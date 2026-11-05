/** A minimal MP4 (ftyp, optional mdat, moov with mvhd) with the given duration, for tests. */
export function mp4Bytes(o: {
  duration: number;
  timescale: number;
  version?: 0 | 1;
  mdatBytes?: number;
  moovBefore?: string[];
  noMvhd?: boolean;
  largeMoov?: boolean;
}): Uint8Array<ArrayBuffer> {
  const box = (type: string, body: Uint8Array, large = false): Uint8Array<ArrayBuffer> => {
    const head = large ? 16 : 8;
    const out = new Uint8Array(head + body.length);
    const view = new DataView(out.buffer);
    if (large) {
      view.setUint32(0, 1);
      view.setBigUint64(8, BigInt(out.length));
    } else view.setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, head);
    return out;
  };
  const join = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const v1 = o.version === 1;
  const mvhdBody = new Uint8Array(v1 ? 112 : 100);
  const mv = new DataView(mvhdBody.buffer);
  mv.setUint8(0, v1 ? 1 : 0);
  if (v1) {
    mv.setUint32(20, o.timescale);
    mv.setBigUint64(24, BigInt(o.duration));
  } else {
    mv.setUint32(12, o.timescale);
    mv.setUint32(16, o.duration);
  }
  const children = [
    ...(o.moovBefore ?? []).map((t) => box(t, new Uint8Array(12))),
    ...(o.noMvhd ? [] : [box('mvhd', mvhdBody)]),
    box('trak', new Uint8Array(20)),
  ];
  const ftyp = box('ftyp', new TextEncoder().encode('isom\0\0\0\0isomavc1'));
  const mdat = o.mdatBytes ? [box('mdat', new Uint8Array(o.mdatBytes))] : [];
  return join(ftyp, ...mdat, box('moov', join(...children), o.largeMoov === true));
}

import { describe, expect, it } from 'vitest';
import { mp4Duration } from '../../src/motion/mp4';
import { mp4Bytes } from './mp4Fixture';

describe('mp4Duration (the moov/mvhd box)', () => {
  it('reads a version 0 mvhd: 4032 at timescale 1000 is 4.032 s', () => {
    expect(mp4Duration(mp4Bytes({ duration: 4032, timescale: 1000 }))).toBe(4.032);
  });

  it('reads a version 1 mvhd (64-bit times)', () => {
    expect(mp4Duration(mp4Bytes({ duration: 6_006_000, timescale: 1_000_000, version: 1 }))).toBe(6.006);
  });

  it('finds moov after a large mdat box and other boxes, and inside moov after other children', () => {
    const bytes = mp4Bytes({ duration: 90_000 * 8, timescale: 90_000, mdatBytes: 5_000, moovBefore: ['iods'] });
    expect(mp4Duration(bytes)).toBe(8);
  });

  it('reads a box with a 64-bit size', () => {
    expect(mp4Duration(mp4Bytes({ duration: 2500, timescale: 1000, largeMoov: true }))).toBe(2.5);
  });

  it('gives null for bytes that are not an MP4, a missing mvhd, a zero timescale or a cut-off file', () => {
    expect(mp4Duration(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mp4Duration(new TextEncoder().encode('<html>not a video</html>'))).toBeNull();
    expect(mp4Duration(mp4Bytes({ duration: 4000, timescale: 1000, noMvhd: true }))).toBeNull();
    expect(mp4Duration(mp4Bytes({ duration: 4000, timescale: 0 }))).toBeNull();
    const whole = mp4Bytes({ duration: 4000, timescale: 1000 });
    expect(mp4Duration(whole.slice(0, whole.length - 30))).toBeNull();
  });

  it('accepts an ArrayBuffer as well as bytes', () => {
    const bytes = mp4Bytes({ duration: 4032, timescale: 1000 });
    expect(mp4Duration(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(4.032);
  });
});

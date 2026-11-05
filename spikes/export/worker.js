import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioSampleSource, AudioSample,
  Input, BlobSource, ALL_FORMATS, CanvasSink, canEncodeVideo, canEncodeAudio } from 'mediabunny';

const W = 1920, H = 1080, FPS = 30;
const say = (msg) => postMessage({ type: 'log', msg });
const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
let peak = 0; const sample = () => { peak = Math.max(peak, mem()); };

function drawFigure(ctx, w, h, seed, t = 0) {
  ctx.fillStyle = `hsl(${(seed * 47) % 360},40%,${seed % 2 ? 85 : 25}%)`;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = seed % 2 ? '#111' : '#eee'; ctx.lineWidth = Math.max(4, w / 160); ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const cx = w * (0.25 + 0.25 * k), cy = h * 0.5, s = h * 0.18;
    const sw = Math.sin(t * 4 + k + seed) * 0.5;
    ctx.beginPath(); ctx.arc(cx, cy - s * 1.6, s * 0.35, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 1.25); ctx.lineTo(cx, cy + s * 0.4);
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx - s * 0.7, cy - s * 0.2 + sw * s * 0.4);
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.7, cy - s * 0.2 - sw * s * 0.4);
    ctx.moveTo(cx, cy + s * 0.4); ctx.lineTo(cx - s * 0.5, cy + s * 1.4 + sw * s * 0.3);
    ctx.moveTo(cx, cy + s * 0.4); ctx.lineTo(cx + s * 0.5, cy + s * 1.4 - sw * s * 0.3);
    ctx.stroke();
  }
  ctx.fillStyle = ctx.strokeStyle; ctx.font = `${h / 10}px sans-serif`; ctx.fillText('Scene ' + seed, w * 0.05, h * 0.15);
}

async function makeClip(i, dur) {
  const cw = 1280, ch = 720;
  const c = new OffscreenCanvas(cw, ch), ctx = c.getContext('2d');
  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const src = new CanvasSource(c, { codec: 'avc', bitrate: 4_000_000, latencyMode: 'realtime' });
  out.addVideoTrack(src, { frameRate: FPS });
  await out.start();
  const n = Math.round(dur * FPS);
  for (let f = 0; f < n; f++) { drawFigure(ctx, cw, ch, 100 + i, f / FPS); await src.add(f / FPS, 1 / FPS); }
  src.close(); await out.finalize();
  return new Blob([out.target.buffer], { type: 'video/mp4' });
}

async function run({ stillSec = 4.5 }) {
  const t0 = performance.now();
  const vOK = await canEncodeVideo('avc', { width: W, height: H, bitrate: 8_000_000 });
  const aOK = await canEncodeAudio('aac');
  say(`canEncode avc=${vOK} aac=${aOK}`);
  if (!vOK) throw new Error('H.264 encode unsupported');

  // synthetic inputs
  const tg = performance.now();
  const stills = [];
  for (let i = 0; i < 10; i++) {
    const c = new OffscreenCanvas(2400, 1350); drawFigure(c.getContext('2d'), 2400, 1350, i);
    stills.push(c);
  }
  const clipDurs = [3, 3.5, 4, 4.5, 5, 5.5, 6, 3.2, 4.8, 5.5];
  const clips = [];
  for (let i = 0; i < 10; i++) clips.push({ blob: await makeClip(i, clipDurs[i]), dur: clipDurs[i] });
  const genMs = performance.now() - tg;
  say(`inputs generated in ${(genMs / 1000).toFixed(1)}s (clip bytes ${clips.reduce((a, c) => a + c.blob.size, 0)})`);

  // audio ~90s, stereo 48k voice-like
  const SR = 48000, total = 90;
  const frames = SR * total;
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / SR, env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    const v = 0.25 * env * (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.3 * Math.sin(2 * Math.PI * 560 * t));
    L[i] = v; R[i] = v;
  }

  const te = performance.now();
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
  const vsrc = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000, keyFrameInterval: 2, latencyMode: 'quality' });
  const asrc = new AudioSampleSource({ codec: 'aac', bitrate: 128_000 });
  out.addVideoTrack(vsrc, { frameRate: FPS });
  out.addAudioTrack(asrc);
  await out.start();

  // audio in 1s chunks
  for (let s = 0; s < total; s++) {
    const data = new Float32Array(SR * 2);
    data.set(L.subarray(s * SR, (s + 1) * SR), 0); data.set(R.subarray(s * SR, (s + 1) * SR), SR);
    const smp = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: SR, timestamp: s });
    await asrc.add(smp); smp.close();
  }
  asrc.close();

  let tl = 0, frameCount = 0, stillMs = 0, clipMs = 0;
  const addFrame = async () => { await vsrc.add(tl, 1 / FPS); tl += 1 / FPS; frameCount++; if (frameCount % 30 === 0) sample(); };
  // interleave: still, clip, still, clip...
  for (let i = 0; i < 10; i++) {
    let ts = performance.now();
    const n = Math.round(stillSec * FPS), img = stills[i];
    for (let f = 0; f < n; f++) {
      const p = f / n, z = 1 + 0.15 * p;
      const sw = img.width / z, sh = img.height / z;
      const dir = i % 2 ? 1 : -1;
      const sx = (img.width - sw) * (0.5 + dir * 0.5 * p * (i % 4 < 2 ? 1 : 0.4) );
      const sy = (img.height - sh) * 0.5;
      ctx.drawImage(img, Math.max(0, Math.min(img.width - sw, sx)), sy, sw, sh, 0, 0, W, H);
      await addFrame();
    }
    stillMs += performance.now() - ts; ts = performance.now();
    const input = new Input({ source: new BlobSource(clips[i].blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new CanvasSink(track, { width: W, height: H, fit: 'cover' });
    const end = clips[i].dur; let cf = 0;
    for await (const w of sink.canvases(0, end)) {
      ctx.drawImage(w.canvas, 0, 0); await addFrame(); cf++;
    }
    input.dispose?.();
    clipMs += performance.now() - ts;
    say(`seg ${i}: clip frames ${cf}/${Math.round(end * FPS)}`);
  }
  vsrc.close();
  await out.finalize();
  const encMs = performance.now() - te;
  sample();
  const buf = out.target.buffer;
  say(`done frames=${frameCount} dur=${tl.toFixed(1)}s enc=${(encMs / 1000).toFixed(1)}s size=${buf.byteLength}`);
  postMessage({ type: 'done', buffer: buf, stats: { frames: frameCount, videoSec: tl, encodeMs: encMs, stillMs, clipMs, genMs, totalMs: performance.now() - t0, bytes: buf.byteLength, peakHeap: peak, heapEnd: mem(), hasMemoryApi: !!performance.memory } }, [buf]);
}

onmessage = async (e) => {
  try { await run(e.data); } catch (err) { postMessage({ type: 'error', msg: String(err && err.stack || err) }); }
};

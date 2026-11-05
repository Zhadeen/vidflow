# Spike S3: in-browser 1080p export (WebCodecs + MP4 mux in a Worker)

Verdict: **usable with caveats.** Code: `spikes/export/` (throwaway, never imported by `src/`).

## Approach that worked
A Web Worker (module) does everything with OffscreenCanvas + `mediabunny`:
- 10 stills (2400x1350 canvas stick figures), each 4.5 s of Ken Burns (zoom 1.0 to 1.15 plus pan) drawn via `drawImage` source-rect crop to a 1920x1080 canvas.
- 10 clips (1280x720, 3-6 s, themselves generated as H.264 MP4s by the spike) decoded with `Input`/`BlobSource` + `CanvasSink` (WebCodecs VideoDecoder), scaled `cover` to 1080p.
- One 90 s stereo 48 kHz synthetic voice-like track pushed as `AudioSample` chunks (f32-planar) into an `AudioSampleSource`.
- Segments interleaved still, clip, still, clip... = 2700 frames, 90.0 s.
- Output through `CanvasSource` (VideoEncoder) + `Mp4OutputFormat({fastStart:'in-memory'})` + `BufferTarget`.

## Library and versions
mediabunny 1.65.2 (no other mux lib needed; mp4-muxer/ffmpeg.wasm not tried, not needed), vite 8.3.5 (dev server), playwright 1.64.1 driving installed Google Chrome (channel `chrome`, UA HeadlessChrome/156, headless).

## Codec settings
Video: `avc` (H.264 High), 8 Mbps, 30 fps, keyframe every 2 s, latencyMode quality. Audio: `aac` LC 128 kbps, 48 kHz stereo. Container: MP4, faststart in memory.

## Results (1080p, 2700 frames, 90 s, Apple-silicon-class Mac, headless Chrome 156)
| Metric | Run 1 | Run 2 |
|---|---|---|
| Export (encode) time | 44.0 s | 56.4 s |
| of which still segments (1350 frames) | 13.1 s | n/a |
| of which clip decode+scale+encode (1350 frames) | 28.3 s | n/a |
| Throughput | ~61 fps | ~48 fps |
| Synthetic input generation (not part of export) | 19.9 s | 37.9 s |
| Output size | 71.7 MB (6.4 Mbps avg) | identical |

Wall time to export a 90 s video was roughly half the video length. Run 2 was slower because other processes were running on the machine; expect +-30% variance.

## Memory
- `performance.memory` is not exposed in workers, so no JS heap number. Measured OS RSS per process by polling `ps` (peaks): renderer (incl. worker) ~623 MB, GPU process ~307 MB, browser ~362 MB. (The summed "total" printed by the script, 6.4 GB, also matched the user's own unrelated Chrome processes and is not meaningful.)
- The whole output (72 MB) is held in memory by `BufferTarget`, plus the encoder queue. For longer or higher-bitrate videos use `StreamTarget`/File System Access (`showSaveFilePicker`) or OPFS to avoid holding the file in RAM.

## Output validity
- `ffprobe`: h264 High 1920x1080, 30 fps, nb_frames 2700; aac LC 48000 Hz 2 ch; duration 90.025 s; size 71742207. `ffmpeg -i out.mp4 -f null -` decodes cleanly, no errors.
- macOS `afinfo` and Spotlight (`mdls`) read it: codecs H.264 + MPEG-4 AAC, duration 90.025 s. So it is QuickTime-compatible.
- Not eyeballed frame by frame; no A/V drift measured beyond matching durations.

## Problems hit
- Playwright's bundled headless shell (build 1248) was not installed and downloads were not approved, so I used the installed Google Chrome (`channel: 'chrome'`). Bundled Chromium (the open-source build) lacks H.264/AAC encoders, so this is expected to need real Chrome; not tested.
- `AudioBuffer` is not available in workers: build `AudioSample` from raw Float32Array instead (works).
- No heap metric in workers (see Memory).
- Everything ran on one worker thread; decode, canvas, and encode are pipelined by the browser, but there is no parallelism across segments. Real photos / real user clips will cost more on decode and image decode (`createImageBitmap`) than these synthetic ones.
- Backpressure: `await source.add()` already throttles the encoder queue in mediabunny; no manual handling was needed.

## Recommendation for VidFlow Export: usable with caveats
Good: pure client-side, no server, valid MP4 that plays in QuickTime/ffprobe, roughly 0.5x realtime at 1080p30 on a modern Mac.
Caveats to design for:
1. Requires real Chrome H.264/AAC encoders (check `canEncodeVideo('avc')`/`canEncodeAudio('aac')` at runtime and show a fallback message; Chromium builds, some Linux builds, and low-end devices may lack them).
2. Use streaming output (File System Access / OPFS) for long videos; add progress and cancel (frame loop makes both easy).
3. Run in a Worker (or offscreen document in MV3; the extension service worker cannot host a long job) and keep the tab/document alive during export.
4. Input decoding: verify the user-clip codecs are decodable by WebCodecs (H.264 fine; HEVC/ProRes vary); only the HW-decodable set will work.
5. Test on a slower Windows/Intel machine before promising time estimates; only one Apple-silicon-class Mac was measured. Peak per-process RSS stayed under ~650 MB for 1080p.

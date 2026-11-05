const log = (m) => { document.getElementById('log').textContent += m + '\n'; };
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
window.__result = null;
worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'log') log(d.msg);
  if (d.type === 'done') {
    const bytes = new Uint8Array(d.buffer);
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    window.__b64 = btoa(bin);
    window.__result = { ...d, buffer: undefined };
  }
  if (d.type === 'error') window.__result = { error: d.msg };
};
window.__start = (opts) => worker.postMessage({ type: 'start', ...opts });

export async function workerProbe(): Promise<Record<string, unknown>> {
  if (typeof Worker === 'undefined') return { status: 'FAIL', error: 'Worker unavailable' };
  const code = `onmessage = async e => {
    try {
      const m = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
      postMessage({ token: e.data, wasm: !!m.instance, moduleWorker: true });
    } catch (e) { postMessage({ token: e.data, wasm: false, error: String(e) }); }
  }`;
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  let worker: Worker | undefined;
  let timer: number | undefined;
  const started = performance.now();
  try {
    worker = new Worker(url, { type: 'module', name: 'inkpdf-probe' });
    const w = worker;
    return await new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error('Worker timeout after 5s')), 5000);
      w.onerror = () => reject(new Error('Blob module Worker failed'));
      w.onmessageerror = () => reject(new Error('Worker message decode failed'));
      w.onmessage = e => {
        if (e.data?.token !== 'inkpdf-ping-v1') return;
        resolve({ status: e.data.wasm ? 'PASS' : 'FAIL', ...e.data, elapsedMs: Math.round(performance.now() - started) });
      };
      w.postMessage('inkpdf-ping-v1');
    });
  } catch (error) {
    return { status: 'FAIL', error: String(error) };
  } finally {
    window.clearTimeout(timer);
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}

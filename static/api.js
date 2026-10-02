// The source app uses the local server. The Pages build selects the browser
// runtime in index.html so both versions share the same UI and API contract.
export const isBrowserRuntime = globalThis.document?.querySelector('meta[name="chamber-runtime"]')?.content === 'browser';

let worker, workerFailure, nextId = 0;
const pending = new Map();
const progressListeners = new Set();

export function onRuntimeProgress(listener) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function abortError() {
  return new DOMException('The request was aborted.', 'AbortError');
}

function failWorker(detail) {
  workerFailure = new Error('Browser geometry is unavailable. Check your connection and reload the page.' + (detail ? ' ' + detail : ''));
  workerFailure.name = 'GeometryRuntimeError';
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    request.cleanup();
    request.reject(workerFailure);
  }
  pending.clear();
  return workerFailure;
}

function getWorker() {
  if (workerFailure) throw workerFailure;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./geometry-worker.js', import.meta.url), {type: 'module'});
    worker.addEventListener('message', ({data}) => {
      if (data?.type === 'progress') {
        for (const listener of progressListeners) listener(data.message);
        return;
      }
      if (data?.type === 'error') {
        failWorker(data.message);
        return;
      }
      const request = pending.get(data?.id);
      if (!request) return; // Includes replies to requests already aborted.
      pending.delete(data.id);
      request.cleanup();
      try {
        const isText = typeof data.body === 'string';
        request.resolve(new Response(isText ? data.body : JSON.stringify(data.body), {
          status: data.status,
          headers: {'Content-Type': isText ? 'text/x-python; charset=utf-8' : 'application/json; charset=utf-8'},
        }));
      } catch (error) {
        request.reject(error);
      }
    });
    worker.addEventListener('error', event => {
      event.preventDefault?.();
      failWorker(event.message);
    });
    worker.addEventListener('messageerror', () => failWorker('The geometry response could not be read.'));
    return worker;
  } catch (error) {
    throw failWorker(error.message);
  }
}

export function apiFetch(path, options = {}) {
  if (!isBrowserRuntime) return fetch(path, options);
  if (options.signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let runtime;
    try { runtime = getWorker(); } catch (error) { reject(error); return; }
    const id = ++nextId;
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const abort = () => {
      pending.delete(id);
      cleanup();
      reject(abortError());
    };
    pending.set(id, {resolve, reject, cleanup});
    options.signal?.addEventListener('abort', abort, {once: true});
    try {
      runtime.postMessage({id, path, body: options.body});
    } catch (error) {
      pending.delete(id);
      cleanup();
      reject(error);
    }
  });
}

import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';

const originalDocument = globalThis.document;
const originalWorker = globalThis.Worker;
const originalFetch = globalThis.fetch;
let moduleId = 0;

class FakeWorker {
  static instances = [];
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.requests = [];
    this.listeners = new Map();
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  postMessage(request) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  emit(type, event) { this.listeners.get(type)?.(event); }
  reply(request, body, status = 200) { this.emit('message', {data: {id: request.id, status, body}}); }
}

async function client(mode = 'browser') {
  FakeWorker.instances = [];
  globalThis.document = {querySelector: () => mode ? {content: mode} : null};
  globalThis.Worker = FakeWorker;
  return import(`../static/api.js?test=${++moduleId}`);
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.Worker = originalWorker;
  globalThis.fetch = originalFetch;
});

test('server mode, including the default, delegates to native fetch', async () => {
  for (const mode of ['server', null]) {
    const {apiFetch, isBrowserRuntime} = await client(mode);
    const options = {method: 'POST', body: '{}'};
    const response = new Response('server');
    globalThis.fetch = (path, supplied) => {
      assert.equal(path, '/api/evaluate');
      assert.equal(supplied, options);
      return Promise.resolve(response);
    };
    assert.equal(isBrowserRuntime, false);
    assert.equal(await apiFetch('/api/evaluate', options), response);
    assert.equal(FakeWorker.instances.length, 0);
  }
});

test('one relative module worker correlates out-of-order JSON and export replies', async () => {
  const {apiFetch, isBrowserRuntime} = await client();
  assert.equal(isBrowserRuntime, true);
  const catalog = apiFetch('/api/catalog');
  const exported = apiFetch('/api/export', {method: 'POST', body: '{"ports":[]}'});
  assert.equal(FakeWorker.instances.length, 1);
  const worker = FakeWorker.instances[0];
  assert.equal(worker.url.href, new URL('../static/geometry-worker.js', import.meta.url).href);
  assert.deepEqual(worker.options, {type: 'module'});
  assert.equal(worker.requests[1].body, '{"ports":[]}');
  worker.reply(worker.requests[1], '# Fusion script\n');
  worker.reply(worker.requests[0], {flanges: []});
  const exportResponse = await exported;
  assert.equal(exportResponse.ok, true);
  assert.match(exportResponse.headers.get('Content-Type'), /text\/x-python/);
  assert.equal(await exportResponse.text(), '# Fusion script\n');
  const catalogResponse = await catalog;
  assert.match(catalogResponse.headers.get('Content-Type'), /application\/json/);
  assert.deepEqual(await catalogResponse.json(), {flanges: []});
});

test('validation errors preserve response status and leave the worker usable', async () => {
  const {apiFetch} = await client();
  const invalid = apiFetch('/api/export', {body: '{}'});
  const worker = FakeWorker.instances[0];
  worker.reply(worker.requests[0], {error: 'Invalid configuration'}, 422);
  const response = await invalid;
  assert.equal(response.ok, false);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {error: 'Invalid configuration'});
  const retry = apiFetch('/api/default');
  worker.reply(worker.requests[1], {ports: []});
  assert.equal((await retry).ok, true);
  assert.equal(worker.terminated, false);
});

test('an already aborted request does not initialize the geometry worker', async () => {
  const {apiFetch} = await client();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiFetch('/api/evaluate', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(FakeWorker.instances.length, 0);
});

test('aborting discards the late result without cancelling another request', async () => {
  const {apiFetch} = await client();
  const controller = new AbortController();
  const cancelled = apiFetch('/api/evaluate', {signal: controller.signal});
  const current = apiFetch('/api/evaluate');
  const worker = FakeWorker.instances[0];
  const rejected = assert.rejects(cancelled, {name: 'AbortError'});
  controller.abort();
  await rejected;
  worker.reply(worker.requests[0], {old: true});
  worker.reply(worker.requests[1], {current: true});
  assert.deepEqual(await (await current).json(), {current: true});
  assert.equal(worker.terminated, false);
});

test('worker failure rejects every pending request and gives recovery guidance', async () => {
  const {apiFetch} = await client();
  const first = apiFetch('/api/catalog');
  const second = apiFetch('/api/default');
  const firstRejected = assert.rejects(first, /reload the page/);
  const secondRejected = assert.rejects(second, /Runtime failed/);
  const worker = FakeWorker.instances[0];
  worker.emit('error', {message: 'Runtime failed'});
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(worker.terminated, true);
  await assert.rejects(apiFetch('/api/default'), /reload the page/);
  assert.equal(FakeWorker.instances.length, 1);
});

test('initialization and unreadable-message failures reject requests', async () => {
  for (const event of [
    {type: 'message', data: {type: 'error', message: 'Download failed'}},
    {type: 'messageerror'},
  ]) {
    const {apiFetch} = await client();
    const response = apiFetch('/api/default');
    const rejected = assert.rejects(response, /reload the page/);
    FakeWorker.instances[0].emit(event.type, event);
    await rejected;
  }
  const {apiFetch} = await client();
  globalThis.Worker = class { constructor() { throw Error('Workers blocked'); } };
  await assert.rejects(apiFetch('/api/default'), /Workers blocked/);
});

test('startup progress can be observed and unsubscribed without settling API calls', async () => {
  const {apiFetch, onRuntimeProgress} = await client();
  const messages = [];
  const stop = onRuntimeProgress(message => messages.push(message));
  const response = apiFetch('/api/default');
  const worker = FakeWorker.instances[0];
  worker.emit('message', {data: {type: 'progress', message: 'Loading geometry tools…'}});
  stop();
  worker.emit('message', {data: {type: 'progress', message: 'Ready'}});
  worker.reply(worker.requests[0], {ports: []});
  assert.deepEqual(messages, ['Loading geometry tools…']);
  assert.equal((await response).ok, true);
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Readable } from 'node:stream';
import { toNextRequest, writeResponse } from './adapter.js';

test('converts a Node request body to a WHATWG request', async () => {
  const request = Object.assign(Readable.from([Buffer.from('{"ok":true}')]), {
    method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: {}, abortSignal: new AbortController().signal,
  });
  assert.deepEqual(await toNextRequest(request).json(), { ok: true });
});

test('exposes request cookies through NextRequest', () => {
  const request = Object.assign(Readable.from([]), {
    method: 'GET', headers: { host: 'localhost', cookie: 'auth_token=signed%20value' }, socket: {}, abortSignal: new AbortController().signal,
  });
  assert.deepEqual(toNextRequest(request).cookies.get('auth_token'), { name: 'auth_token', value: 'signed value' });
});

test('writes streamed responses and preserves separate cookies', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('one')); controller.enqueue(new TextEncoder().encode('two')); controller.close(); } }), { headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']] });
  const output = new EventEmitter();
  output.headers = new Map(); output.statusCode = 0; output.writableEnded = false;
  output.setHeader = (name, value) => output.headers.set(name, value);
  output.write = (chunk) => { output.body = (output.body || '') + chunk.toString(); return true; };
  output.end = () => { output.writableEnded = true; output.emit('finish'); };
  output.once = output.once.bind(output);
  await writeResponse(response, output);
  assert.equal(output.body, 'onetwo');
  assert.deepEqual(output.headers.get('set-cookie'), ['a=1', 'b=2']);
});

test('settles a streamed response when the client connection closes early', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial')); } }));
  const output = new EventEmitter();
  output.headers = new Map(); output.statusCode = 0; output.writableEnded = false;
  output.setHeader = (name, value) => output.headers.set(name, value);
  output.write = () => true;
  output.end = () => {};
  output.once = output.once.bind(output);
  output.on = output.on.bind(output);
  output.off = output.off.bind(output);
  output.emit('pipe');
  const writing = writeResponse(response, output);
  setImmediate(() => output.emit('close'));
  await writing;
});

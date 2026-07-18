import { Readable } from 'node:stream';
import { NextRequest } from './compat/next-server.js';
import { runWithRequestContext } from './compat/next-headers.js';

class RequestCookies {
  constructor(header, responseHeaders) {
    this.values = new Map(String(header || '').split(';').map((item) => item.trim()).filter((item) => item.includes('=')).map((item) => {
      const separator = item.indexOf('=');
      const rawValue = item.slice(separator + 1);
      try {
        return [item.slice(0, separator), decodeURIComponent(rawValue)];
      } catch {
        return [item.slice(0, separator), rawValue];
      }
    }));
    this.responseHeaders = responseHeaders;
  }

  get(name) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }

  getAll(name) {
    return name ? [this.get(name)].filter(Boolean) : [...this.values].map(([key, value]) => ({ name: key, value }));
  }

  has(name) { return this.values.has(name); }

  set(name, value, options = {}) {
    this.values.set(name, String(value));
    const attributes = { httpOnly: 'HttpOnly', sameSite: 'SameSite', maxAge: 'Max-Age', secure: 'Secure', path: 'Path', domain: 'Domain' };
    const suffix = Object.entries(options).flatMap(([key, option]) => {
      if (option === false || option == null) return [];
      if (key === 'expires') return [`Expires=${new Date(option).toUTCString()}`];
      return [option === true ? attributes[key] || key : `${attributes[key] || key}=${option}`];
    });
    this.responseHeaders.append('set-cookie', `${name}=${encodeURIComponent(value)}${suffix.length ? `; ${suffix.join('; ')}` : ''}`);
  }

  delete(name, options = {}) { this.set(name, '', { ...options, maxAge: 0 }); }
}

function requestUrl(request) {
  const protocol = request.socket?.encrypted ? 'https' : 'http';
  return `${protocol}://${request.headers.host || 'localhost'}${request.originalUrl || request.url}`;
}

export function toNextRequest(request, url = requestUrl(request), headers = request.headers) {
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  return new NextRequest(url || requestUrl(request), {
    method: request.method,
    headers,
    body: hasBody ? Readable.toWeb(request) : undefined,
    duplex: hasBody ? 'half' : undefined,
    signal: request.abortSignal,
  });
}

export async function writeResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') nodeResponse.setHeader(name, value);
  }
  if (setCookies.length) nodeResponse.setHeader('set-cookie', setCookies);
  if (!response.body) return nodeResponse.end();
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(response.body);
    let settled = false;
    const cleanup = () => {
      body.off('error', onError);
      nodeResponse.off('error', onError);
      nodeResponse.off('finish', onFinish);
      nodeResponse.off('close', onClose);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onError = (error) => settle(reject, error);
    const onFinish = () => settle(resolve);
    const onClose = () => {
      if (!nodeResponse.writableEnded) body.destroy();
      settle(resolve);
    };
    body.once('error', onError);
    nodeResponse.once('error', onError);
    nodeResponse.once('finish', onFinish);
    nodeResponse.once('close', onClose);
    body.pipe(nodeResponse);
  });
}

export function createRouteAdapter(discovery) {
  return async (request, response, next) => {
    const controller = new AbortController();
    request.abortSignal = controller.signal;
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', () => { if (!response.writableEnded) abort(); });
    try {
      const route = await discovery.match(new URL(requestUrl(request)).pathname);
      if (!route) return next();
      const contextHeaders = new Headers();
      const nextRequest = toNextRequest(request, undefined, request.compatHeaders || request.headers);
      const cookieStore = new RequestCookies(request.headers.cookie, contextHeaders);
      const result = await runWithRequestContext({ headers: nextRequest.headers, cookies: cookieStore }, async () => {
        const handler = route.module[request.method];
        if (!handler) return new Response(null, { status: 405, headers: { allow: Object.keys(route.module).filter((name) => /^[A-Z]+$/.test(name)).join(', ') } });
        return handler(nextRequest, { params: Promise.resolve(route.params) });
      });
      for (const [name, value] of contextHeaders) result.headers.append(name, value);
      return writeResponse(result, response);
    } catch (error) {
      if (controller.signal.aborted) return;
      return next(error);
    } finally {
      request.off('aborted', abort);
    }
  };
}

import { NextRequest } from './compat/next-server.js';
import { writeResponse } from './adapter.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function socketAddress(request) {
  return request.socket?.remoteAddress || '';
}

export function trustedClientHeaders(request) {
  const headers = { ...request.headers };
  const socketIp = socketAddress(request);
  const forwarded = headers['x-forwarded-for'];
  const xRealIp = headers['x-real-ip'];
  const viaProxy = LOOPBACK.has(socketIp) && Boolean(forwarded || xRealIp);
  const forwardedIp = xRealIp || (forwarded ? String(forwarded).split(',', 1)[0].trim() : '');
  const clientIp = LOOPBACK.has(socketIp) && forwardedIp ? forwardedIp : socketIp;

  delete headers['x-forwarded-for'];
  delete headers['x-real-ip'];
  delete headers['x-9r-real-ip'];
  delete headers['x-9r-via-proxy'];
  headers['x-9r-real-ip'] = clientIp;
  if (viaProxy) headers['x-9r-via-proxy'] = '1';
  return headers;
}

export async function authorizeRequest(url, request) {
  const headers = new Headers(trustedClientHeaders(request));
  const nextRequest = new NextRequest(url, { method: request.method, headers });
  const { proxy: dashboardProxy } = await import('../src/dashboardGuard.js');
  return dashboardProxy(nextRequest);
}

export function createSecurityMiddleware(authorize = authorizeRequest) {
  return async (request, response, next) => {
    try {
      request.compatHeaders = trustedClientHeaders(request);
      const result = await authorize(`${request.socket?.encrypted ? 'https' : 'http'}://${request.headers.host || 'localhost'}${request.originalUrl || request.url}`, request);
      if (result.headers.get('x-9router-continue') === '1') return next();
      result.headers.delete('x-9router-continue');
      return writeResponse(result, response);
    } catch (error) {
      return next(error);
    }
  };
}

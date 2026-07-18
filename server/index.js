import express from 'express';
import { resolve } from 'node:path';
import { initConsoleLogCapture } from '../src/lib/consoleLogBuffer.js';
import { createRouteAdapter } from './adapter.js';
import { createRouteDiscovery } from './route-discovery.js';
import { createSecurityMiddleware } from './security.js';

export function createServer({ securityMiddleware = createSecurityMiddleware() } = {}) {
  initConsoleLogCapture();
  const app = express();
  const clientDirectory = resolve(process.cwd(), 'dist');
  app.disable('x-powered-by');
  app.use(securityMiddleware);
  app.use(createRouteAdapter(createRouteDiscovery()));
  app.use(express.static(clientDirectory, {
    index: false,
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  }));
  app.use((request, response, next) => {
    const pathname = new URL(request.originalUrl || request.url, 'http://localhost').pathname;
    const isApi = ['/api', '/v1', '/v1beta', '/mcp'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    const acceptsHtml = request.accepts('html');
    const hasFileExtension = /\/[^/]+\.[^/]+$/.test(pathname);
    if (!isApi && !hasFileExtension && acceptsHtml && ['GET', 'HEAD'].includes(request.method)) {
      return response.sendFile(resolve(clientDirectory, 'index.html'));
    }
    return next();
  });
  app.use((request, response) => response.status(404).json({ error: 'Not found' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    console.error(error);
    return response.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

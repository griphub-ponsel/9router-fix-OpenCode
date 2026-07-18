import { routeModules } from './route-manifest.js';

const rewrites = [
  ['/v1/v1/:path*', '/api/v1/:path*'],
  ['/v1/v1', '/api/v1'],
  ['/codex/:path*', '/api/v1/responses'],
  ['/responses', '/api/v1/responses'],
  ['/v1beta/:path*', '/api/v1beta/:path*'],
  ['/v1beta', '/api/v1beta'],
  ['/v1/:path*', '/api/v1/:path*'],
  ['/v1', '/api/v1'],
];

function normalizePathname(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function matchPattern(pattern, pathname) {
  const source = normalizePathname(pattern).split('/').filter(Boolean);
  const actual = normalizePathname(pathname).split('/').filter(Boolean);
  const params = {};
  let index = 0;
  for (; index < source.length; index += 1) {
    const part = source[index];
    const catchall = part.match(/^\[\.\.\.(.+)]$/);
    const dynamic = part.match(/^\[(.+)]$/);
    if (catchall) {
      params[catchall[1]] = actual.slice(index).map(decodeURIComponent);
      return params;
    }
    if (index >= actual.length) return null;
    if (dynamic) {
      params[dynamic[1]] = decodeURIComponent(actual[index]);
    } else if (part !== actual[index]) {
      return null;
    }
  }
  return index === actual.length ? params : null;
}

function applyDestination(destination, params) {
  return destination.replace(/:([A-Za-z0-9_]+)\*/g, (_, name) => (params[name] || []).map(encodeURIComponent).join('/'));
}

export function applyRewrites(pathname) {
  for (const [source, destination] of rewrites) {
    const params = matchPattern(source.replace(/:([A-Za-z0-9_]+)\*/g, '[...$1]'), pathname);
    if (params) return applyDestination(destination, params);
  }
  return pathname;
}

export function createRouteDiscovery(routes = routeModules) {
  const compiled = routes.map((route) => ({
    ...route,
    pattern: route.pathname || route.file
      .replace(/^src\/app/, '')
      .replace(/\/route\.js$/, '')
      .replace(/\/(?:page|index)$/, '') || '/',
  })).sort((a, b) => {
    const rank = (value) => value.includes('[...') ? 2 : value.includes('[') ? 1 : 0;
    return rank(a.pattern) - rank(b.pattern) || b.pattern.length - a.pattern.length;
  });

  return {
    async match(pathname) {
      const rewrittenPathname = applyRewrites(pathname);
      for (const route of compiled) {
        const params = matchPattern(route.pattern, rewrittenPathname);
        if (params) return { module: await route.load(), params, pathname: rewrittenPathname, route };
      }
      return null;
    },
    routes: compiled,
  };
}

export { rewrites };

const APP_PREFIX = '/src/app/';

export function pagePathToRoute(pagePath) {
  const relativePath = pagePath.replace(APP_PREFIX, '').replace(/\/?page\.js$/, '');
  const segments = relativePath.split('/').filter((segment) => segment && !/^\(.+\)$/.test(segment));

  const routeSegments = segments.map((segment) => {
    const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    const parameter = segment.match(/^\[(.+)\]$/);

    if (optionalCatchAll || catchAll) return '*';
    if (parameter) return `:${parameter[1]}`;
    return segment;
  });

  return routeSegments.length ? `/${routeSegments.join('/')}` : '/';
}

function routeRank(route) {
  return route.split('/').filter(Boolean).map((segment) => {
    if (segment === '*') return 2;
    if (segment.startsWith(':')) return 1;
    return 0;
  });
}

export function sortRoutes(routes) {
  return [...routes].sort((left, right) => {
    const leftRank = routeRank(left);
    const rightRank = routeRank(right);
    const length = Math.max(leftRank.length, rightRank.length);

    for (let index = 0; index < length; index += 1) {
      const difference = (leftRank[index] ?? -1) - (rightRank[index] ?? -1);
      if (difference) return difference;
    }

    return left.localeCompare(right);
  });
}

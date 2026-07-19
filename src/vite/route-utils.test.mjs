import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dashboardAuthDestination, pagePathToRoute, sortRoutes } from './route-utils.js';

test('redirects an unauthenticated Vite dashboard request to login', () => {
  assert.equal(dashboardAuthDestination('/dashboard/providers', 401), '/login');
  assert.equal(dashboardAuthDestination('/dashboard', 403), '/login');
  assert.equal(dashboardAuthDestination('/dashboard', 200), null);
  assert.equal(dashboardAuthDestination('/login', 401), null);
});


const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');

async function pagePaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return pagePaths(entryPath);
    return entry.name === 'page.js' ? [entryPath] : [];
  }));
  return nested.flat();
}

test('converts the current 29 page modules into React Router paths', async () => {
  const pages = await pagePaths(appDirectory);
  const routes = sortRoutes(pages.map((page) => pagePathToRoute(page.replace(appDirectory, '/src/app').replaceAll(path.sep, '/'))));

  assert.equal(pages.length, 29);
  assert.equal(pagePathToRoute('/src/app/page.js'), '/');
  assert.equal(pagePathToRoute('/src/app/dashboard/[section]/page.js'), '/dashboard/:section');
  assert.equal(pagePathToRoute('/src/app/(marketing)/docs/[...slug]/page.js'), '/docs/*');
  assert.deepEqual(sortRoutes(['/users/*', '/users/:id', '/users/new']), ['/users/new', '/users/:id', '/users/*']);
  assert.ok(routes.includes('/'));
  assert.ok(routes.includes('/dashboard'));
  await access(path.join(appDirectory, '(dashboard)', 'layout.js'));
});

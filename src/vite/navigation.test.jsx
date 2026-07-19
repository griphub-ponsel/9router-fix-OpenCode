import assert from 'node:assert/strict';
import test from 'node:test';
// React is required by tsx's classic JSX transform in this node:test file.
// eslint-disable-next-line no-unused-vars
import React, { lazy, Suspense } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import CompatLink from './compat/link.jsx';

const Endpoint = lazy(async () => ({ default: () => <h1>Endpoint content</h1> }));
const Providers = lazy(async () => ({ default: () => <h1>Providers content</h1> }));

test('client-side navigation replaces page content', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dashboard' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Link to="/dashboard/providers">Providers</Link>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/dashboard" element={<Endpoint />} />
            <Route path="/dashboard/providers" element={<Providers />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );
  });
  assert.match(document.body.textContent, /Endpoint content/);
  await act(async () => document.querySelector('a').click());
  assert.match(document.body.textContent, /Providers content/);
  assert.doesNotMatch(document.body.textContent, /Endpoint content/);
  await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
});

test('compat link keeps current content visible while the next page loads', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dashboard' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  let finishLoading;
  const SlowProviders = lazy(() => new Promise((resolve) => {
    finishLoading = () => resolve({ default: () => <h1>Providers content</h1> });
  }));
  const root = createRoot(document.getElementById('root'));

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompatLink href="/dashboard/providers">Providers</CompatLink>
        <Suspense fallback={<p>Loading...</p>}>
          <Routes>
            <Route path="/dashboard" element={<h1>Endpoint content</h1>} />
            <Route path="/dashboard/providers" element={<SlowProviders />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );
  });

  await act(async () => document.querySelector('a').click());
  assert.match(document.body.textContent, /Endpoint content/);
  assert.doesNotMatch(document.body.textContent, /Loading/);

  await act(async () => finishLoading());
  assert.match(document.body.textContent, /Providers content/);
  await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
});

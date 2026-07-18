import { AsyncLocalStorage } from 'node:async_hooks';

const requestStorage = new AsyncLocalStorage();

function currentStore() {
  const store = requestStorage.getStore();
  if (!store) throw new Error('next/headers was called outside a request scope');
  return store;
}

export function runWithRequestContext(context, callback) {
  return requestStorage.run(context, callback);
}

export function headers() {
  return currentStore().headers;
}

export function cookies() {
  return currentStore().cookies;
}

export function draftMode() {
  const store = currentStore();
  return {
    get isEnabled() { return Boolean(store.draftMode); },
    enable() { store.draftMode = true; },
    disable() { store.draftMode = false; },
  };
}

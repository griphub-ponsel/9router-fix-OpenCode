const MACHINE_ID_KEY = '9router-machine-id';
const CLI_SECRET_KEY = '9router-cli-secret';
const CLI_AUTH_SALT = '9r-cli-auth';

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') || `${Date.now()}-${Math.random()}`;
}

function getStoredId(key) {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const created = createId();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return createId();
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto?.subtle?.digest('SHA-256', bytes);
  if (!digest) return value;
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getConsistentMachineId(salt = null) {
  const saltValue = salt || import.meta.env.VITE_MACHINE_ID_SALT || 'endpoint-proxy-salt';
  const extra = saltValue === CLI_AUTH_SALT ? getStoredId(CLI_SECRET_KEY) : '';
  return (await sha256(getStoredId(MACHINE_ID_KEY) + saltValue + extra)).substring(0, 16);
}

export async function getRawMachineId() {
  return getStoredId(MACHINE_ID_KEY);
}

export function isBrowser() {
  return true;
}

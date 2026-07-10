// Audit script: inspect live 9router DB for request volume & settings (read-only)
const db = require('better-sqlite3')(process.env.APPDATA + '/9router/db/data.sqlite', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('TABLES:', tables.join(', '));

// Settings of interest
try {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const interesting = ['memoryExtractModel', 'comboStrategy', 'headroomEnabled', 'requireApiKey', 'quotaAutoPing', 'autoPing'];
  for (const r of rows) {
    if (interesting.some(k => r.key.toLowerCase().includes(k.toLowerCase())) || /memory|ping|auto|kiro/i.test(r.key)) {
      console.log('SETTING:', r.key, '=', String(r.value).slice(0, 200));
    }
  }
} catch (e) { console.log('settings read err:', e.message); }

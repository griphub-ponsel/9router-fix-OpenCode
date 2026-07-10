// Audit v4: combos content + requestDetails stats + error statuses (read-only)
const db = require('better-sqlite3')(process.env.APPDATA + '/9router/db/data.sqlite', { readonly: true });

console.log('=== combos ===');
for (const c of db.prepare('SELECT name, kind, models FROM combos').all()) {
  console.log(c.name, '|', c.kind, '|', String(c.models).slice(0, 300));
}

console.log('\n=== usageHistory distinct status ===');
for (const r of db.prepare('SELECT status, COUNT(*) n FROM usageHistory GROUP BY status').all()) {
  console.log(r.status, r.n);
}

console.log('\n=== requestDetails cols ===');
console.log(db.prepare('PRAGMA table_info(requestDetails)').all().map(c => c.name).join(', '));

const since = Date.now() - 48 * 3600 * 1000;
try {
  const sample = db.prepare('SELECT * FROM requestDetails ORDER BY rowid DESC LIMIT 1').get();
  console.log('\nsample requestDetails keys:', Object.keys(sample || {}));
  if (sample) {
    for (const [k, v] of Object.entries(sample)) {
      console.log(k, '=>', String(v).slice(0, 150));
    }
  }
} catch (e) { console.log('rd err:', e.message); }

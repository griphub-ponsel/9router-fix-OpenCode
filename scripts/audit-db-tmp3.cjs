// Audit v3: request volume per provider/model last 48h, kiro deep-dive (read-only)
const db = require('better-sqlite3')(process.env.APPDATA + '/9router/db/data.sqlite', { readonly: true });

const since = Date.now() - 48 * 3600 * 1000;

// Detect timestamp format
const sample = db.prepare('SELECT timestamp FROM usageHistory ORDER BY id DESC LIMIT 1').get();
console.log('sample ts:', sample?.timestamp);

const rows = db.prepare(`
  SELECT provider, model, status, COUNT(*) n
  FROM usageHistory
  WHERE (CASE WHEN typeof(timestamp)='integer' THEN timestamp ELSE strftime('%s', timestamp)*1000 END) > ?
  GROUP BY provider, model, status
  ORDER BY n DESC
  LIMIT 40
`).all(since);
console.log('=== last 48h by provider/model/status ===');
for (const r of rows) console.log(`${String(r.n).padStart(5)}  ${r.provider}  ${r.model}  status=${r.status}`);

// Hourly kiro volume
const kiro = db.prepare(`
  SELECT strftime('%m-%d %H:00', CASE WHEN typeof(timestamp)='integer' THEN timestamp/1000 ELSE strftime('%s', timestamp) END, 'unixepoch', 'localtime') hr, COUNT(*) n
  FROM usageHistory
  WHERE provider LIKE '%kiro%' AND (CASE WHEN typeof(timestamp)='integer' THEN timestamp ELSE strftime('%s', timestamp)*1000 END) > ?
  GROUP BY hr ORDER BY hr DESC LIMIT 30
`).all(since);
console.log('=== kiro hourly ===');
for (const r of kiro) console.log(`${r.hr}  ${r.n}`);

// Total per provider
const tot = db.prepare(`
  SELECT provider, COUNT(*) n FROM usageHistory
  WHERE (CASE WHEN typeof(timestamp)='integer' THEN timestamp ELSE strftime('%s', timestamp)*1000 END) > ?
  GROUP BY provider ORDER BY n DESC
`).all(since);
console.log('=== totals last 48h ===');
for (const r of tot) console.log(`${String(r.n).padStart(5)}  ${r.provider}`);

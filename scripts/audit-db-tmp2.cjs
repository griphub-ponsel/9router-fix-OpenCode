// Audit script v2: request volume per provider over last 24h + settings + combos (read-only)
const db = require('better-sqlite3')(process.env.APPDATA + '/9router/db/data.sqlite', { readonly: true });

function cols(t) { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); }
console.log('settings cols:', cols('settings').join(', '));
console.log('usageHistory cols:', cols('usageHistory').join(', '));
console.log('combos cols:', cols('combos').join(', '));

// settings
try {
  const s = db.prepare('SELECT * FROM settings').all();
  for (const row of s) {
    const str = JSON.stringify(row);
    console.log('SETTINGS ROW (first 3000):', str.slice(0, 3000));
    break;
  }
} catch (e) { console.log('settings err:', e.message); }

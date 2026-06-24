const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const memories = [
  {
    title: 'Grok provider = XOG (bukan xAI)',
    content: 'Di proyek 9router, model Grok yang dipakai user adalah provider XOG - alias xog, provider id xai-oauth, category oauth, auth via accounts.x.ai (SuperGrok/free tier), base URL https://api.x.ai/v1/responses. BUKAN provider xai (API key biasa). Saat update atau merge upstream: jangan timpa/replace config xog yang sudah ada - extend atau patch saja. xog config ada di 3 titik: (1) open-sse/providers/registry/xai-oauth.js, (2) barrel open-sse/providers/registry/index.js, (3) open-sse/executors/index.js (harus ada registrasi "xai-oauth": new XaiOauthExecutor()).'
  },
  {
    title: '9router Memory DB redundancy fix',
    content: 'Masalah redundant: 9router bisa punya beberapa data/9router-memory.sqlite di root, cli/app, .next/standalone, dan .next-cli-build karena path lama bergantung pada process.cwd(). Gejala: memory sudah diinsert tapi tidak muncul di dashboard karena UI membaca DB lain. Fix: pakai satu canonical DB path atau MEMORY_DB_PATH; cek semua DB dengan Get-ChildItem -Filter 9router-memory.sqlite -Recurse; seed/write harus idempotent dan jangan insert manual ke relative cwd sembarang.'
  }
];

const sql = `INSERT INTO memories 
  (id, type, scope, title, content, importance_score, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const dbPaths = [
  'data/9router-memory.sqlite',
  'cli/app/data/9router-memory.sqlite',
  '.next/standalone/data/9router-memory.sqlite',
  '.next-cli-build/standalone/9router-fix-OpenCode/data/9router-memory.sqlite'
].map((item) => path.resolve(item)).filter((item, index, items) => fs.existsSync(item) && items.indexOf(item) === index);

function all(db, query, params = []) {
  return new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}

function run(db, query, params = []) {
  return new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this); }));
}

async function upsertMemory(db, memory) {
  const rows = await all(db, 'SELECT id FROM memories WHERE title = ? ORDER BY created_at ASC', [memory.title]);
  const now = new Date().toISOString();

  if (rows.length === 0) {
    await run(db, sql, [uuidv4(), 'user_pref', 'user', memory.title, memory.content, 1.0, now, now]);
    return 'inserted';
  }

  await run(db, 'UPDATE memories SET type = ?, scope = ?, content = ?, importance_score = ?, updated_at = ? WHERE id = ?', ['user_pref', 'user', memory.content, 1.0, now, rows[0].id]);
  for (const row of rows.slice(1)) {
    await run(db, 'DELETE FROM memories WHERE id = ?', [row.id]);
  }
  return 'updated/deduped';
}

async function seed(dbPath) {
  const db = new sqlite3.Database(dbPath);
  for (const memory of memories) {
    const action = await upsertMemory(db, memory);
    console.log(`${action}: ${memory.title} -> ${dbPath}`);
  }

  db.close();
}

(async () => {
  for (const dbPath of dbPaths) {
    await seed(dbPath);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

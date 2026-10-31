const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, lstatSync, readdirSync, existsSync, openSync, fsyncSync, closeSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
let db;
const validate = chats => {
  if (!Array.isArray(chats) || Buffer.byteLength(JSON.stringify(chats)) > 1024 * 1024) throw Error('Invalid draft storage or capacity exhausted');
  const ids = new Set();
  for (const chat of chats) {
    if (!chat || typeof chat.id !== 'string' || !chat.id || ids.has(chat.id) ||
        !(chat.project === null || typeof chat.project === 'string') || typeof chat.checkout !== 'string' ||
        typeof chat.draft !== 'string' || !(chat.threadId === null || typeof chat.threadId === 'string') ||
        (chat.phase !== undefined && !['draft', 'bound'].includes(chat.phase)) ||
        (chat.directoryIdentity && (typeof chat.directoryIdentity.path !== 'string' || !Number.isSafeInteger(chat.directoryIdentity.dev) || !Number.isSafeInteger(chat.directoryIdentity.ino)))) throw Error('Malformed draft storage');
    ids.add(chat.id);
  }
};
try {
  const marker = workerData + '.established';
  const established = existsSync(marker);
  if (established && !existsSync(workerData)) throw Error('Missing established SQLite directory; explicit recovery required');
  if (!established && existsSync(workerData)) throw Error('Missing SQLite establishment evidence; explicit recovery required');
  if (!established) {
    const fd = openSync(marker, 'wx', 0o600);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  let fresh = false;
  try { mkdirSync(workerData, { mode: 0o700 }); fresh = true; }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (!lstatSync(workerData).isDirectory() || lstatSync(workerData).isSymbolicLink()) throw Error('Invalid SQLite directory');
  const file = join(workerData, 'state.sqlite');
  if (!fresh && (!readdirSync(workerData).includes('state.sqlite') || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw Error('Missing established SQLite storage; explicit recovery required');
  if (readdirSync(workerData).some(name => !['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'receipts'].includes(name))) throw Error('Ambiguous SQLite storage');
  for (const name of readdirSync(workerData)) if (lstatSync(join(workerData, name)).isSymbolicLink()) throw Error('Linked SQLite storage refused');
  db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=3000');
  if (fresh) {
    db.exec(`BEGIN IMMEDIATE; PRAGMA user_version=2;
      CREATE TABLE identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), hostId TEXT NOT NULL, clientId TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE chats (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE submissions (id TEXT PRIMARY KEY, body TEXT NOT NULL, association TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO identity VALUES (1, ?, ?, 0)').run(randomUUID(), randomUUID());
    db.exec('COMMIT');
  }
  if (db.prepare('PRAGMA user_version').get().user_version === 1) db.exec('BEGIN IMMEDIATE; CREATE TABLE submissions (id TEXT PRIMARY KEY, body TEXT NOT NULL, association TEXT NOT NULL); PRAGMA user_version=2; COMMIT');
  if (db.prepare('PRAGMA user_version').get().user_version === 2) db.exec('BEGIN IMMEDIATE; CREATE TABLE preparation_results (id TEXT PRIMARY KEY, previous TEXT NOT NULL, result TEXT NOT NULL); PRAGMA user_version=3; COMMIT');
  if (db.prepare('PRAGMA user_version').get().user_version !== 3 || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Unsupported or corrupt SQLite storage');
  const identity = db.prepare('SELECT * FROM identity').all();
  if (identity.length !== 1 || !/^[0-9a-f-]{36}$/.test(identity[0].hostId) || !/^[0-9a-f-]{36}$/.test(identity[0].clientId) || !Number.isSafeInteger(identity[0].revision)) throw Error('Invalid established SQLite identities');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const record of db.prepare('SELECT * FROM preparation_results').all()) {
      const row = db.prepare('SELECT body FROM chats WHERE id=?').get(record.id);
      if (!row || (row.body !== record.previous && row.body !== record.result)) throw Error('Preparation result conflicts with saved context; explicit recovery required');
      validate([JSON.parse(record.result)]);
      if (row.body === record.previous) {
        db.prepare('UPDATE chats SET body=? WHERE id=?').run(record.result, record.id);
        db.exec('UPDATE identity SET revision=revision+1');
      }
    }
    db.exec('DELETE FROM preparation_results; COMMIT');
    identity[0].revision = db.prepare('SELECT revision FROM identity').get().revision;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  validate(db.prepare('SELECT body FROM chats').all().map(row => JSON.parse(row.body)));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA checkpoint_fullfsync=ON');
  const settings = { journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, synchronous: db.prepare('PRAGMA synchronous').get().synchronous, checkpointFullfsync: db.prepare('PRAGMA checkpoint_fullfsync').get().checkpoint_fullfsync };
  if (settings.journalMode !== 'wal' || settings.synchronous !== 1 || settings.checkpointFullfsync !== 1) throw Error('SQLite durability settings unavailable');
  db.exec('CREATE TABLE IF NOT EXISTS client_recovery (clientId TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(clientId, kind))');
  db.exec(`UPDATE submissions SET body=json_set(body, '$.status', 'uncertain', '$.message', 'Host restarted; inspect provider history. Work was not resent.') WHERE json_extract(body, '$.status') IN ('admitted', 'dispatching')`);
  parentPort.postMessage({ id: 0, value: { ...identity[0], settings } });
} catch (e) { parentPort.postMessage({ id: 0, error: String(e) }); db?.close(); process.exitCode = 1; }
if (db && !process.exitCode) parentPort.on('message', ({ id, operation, chats, revision, commandId, command, epoch, hostId, clientId, receipt, previous, result, kind, body }) => {
  try {
    let value;
    if (operation === 'publishFileFact') {
      if (!body || !body.completed || !['move', 'trash'].includes(body.kind)) throw Error('Invalid shared file fact');
      db.exec('BEGIN IMMEDIATE');
      try {
        const clients = db.prepare("SELECT DISTINCT clientId FROM client_recovery WHERE kind='workspace'").all();
        for (const owner of clients) {
          const row = db.prepare("SELECT body, revision FROM client_recovery WHERE clientId=? AND kind='fileFacts'").get(owner.clientId);
          const facts = row ? JSON.parse(row.body) : [];
          const fact = { ...body, ...(owner.clientId !== clientId && body.kind === 'trash' ? { preserveDrafts: true } : {}) };
          if (!facts.some(f => f.identity === fact.identity && f.source === fact.source && f.destination === fact.destination && f.kind === fact.kind)) facts.push(fact);
          const encoded = JSON.stringify(facts);
          if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw Error('Recovery storage capacity exhausted');
          db.prepare("INSERT INTO client_recovery VALUES (?, 'fileFacts', ?, ?) ON CONFLICT(clientId,kind) DO UPDATE SET revision=excluded.revision, body=excluded.body").run(owner.clientId, (row?.revision ?? 0) + 1, encoded);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (operation === 'observePreparation') {
      validate([previous]); validate([result]);
      if (previous.id !== result.id || previous.project !== result.project || previous.checkout !== result.checkout) throw Error('Preparation identity changed');
      const row = db.prepare('SELECT body FROM chats WHERE id=?').get(previous.id);
      if (!row || row.body !== JSON.stringify(previous)) throw Error('Preparation context changed');
      db.prepare('INSERT INTO preparation_results VALUES (?, ?, ?)').run(previous.id, JSON.stringify(previous), JSON.stringify(result));
    } else if (operation === 'recoveryRead' || operation === 'recoveryWrite') {
      if (typeof clientId !== 'string' || !clientId || !['workspace', 'intent', 'fileFacts'].includes(kind)) throw Error('Invalid recovery owner');
      if (operation === 'recoveryRead') {
        const row = db.prepare('SELECT body, revision FROM client_recovery WHERE clientId=? AND kind=?').get(clientId, kind);
        value = row ? { body: JSON.parse(row.body), revision: row.revision } : { body: null, revision: 0 };
      } else {
        const encoded = JSON.stringify(body);
        if (!encoded || Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw Error('Recovery storage capacity exhausted');
        db.exec('BEGIN IMMEDIATE');
        try {
          const current = db.prepare('SELECT revision FROM client_recovery WHERE clientId=? AND kind=?').get(clientId, kind);
          if ((current?.revision ?? 0) !== revision) throw Error('Recovery storage changed; reopen before retrying');
          db.prepare('INSERT INTO client_recovery VALUES (?, ?, ?, ?) ON CONFLICT(clientId,kind) DO UPDATE SET revision=excluded.revision, body=excluded.body').run(clientId, kind, revision + 1, encoded);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
    }
    else if (operation === 'read') value = { chats: db.prepare('SELECT body FROM chats ORDER BY rowid').all().map(row => JSON.parse(row.body)), revision: db.prepare('SELECT revision FROM identity').get().revision };
    else if (operation === 'write') {
      validate(chats);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT revision FROM identity').get().revision !== revision) throw Error('Draft storage changed; retry after reopening');
        db.exec('DELETE FROM chats');
        const insert = db.prepare('INSERT INTO chats VALUES (?, ?)');
        for (const chat of chats) insert.run(chat.id, JSON.stringify(chat));
        db.exec('DELETE FROM preparation_results WHERE result=(SELECT body FROM chats WHERE chats.id=preparation_results.id)');
        db.exec('UPDATE identity SET revision=revision+1');
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } else if (operation === 'status') {
      const row = db.prepare('SELECT body FROM submissions WHERE id=?').get(commandId);
      value = row ? JSON.parse(row.body) : null;
    } else if (operation === 'admit') {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT body FROM submissions WHERE id=?').get(command.commandId);
        if (row) {
          const previous = JSON.parse(row.body);
          if (JSON.stringify(previous.command) !== JSON.stringify(command)) throw Error('Command identity conflict');
          value = { fresh: false, receipt: previous };
        } else {
          if (command.admissionEpoch !== epoch) throw Error('Expired admission epoch; work was not resent');
          const association = db.prepare('SELECT body FROM chats WHERE id=?').get(command.id);
          if (!association || JSON.parse(association.body).project !== command.project) throw Error('Chat association unavailable');
          if (db.prepare('SELECT count(*) AS n FROM submissions').get().n >= 1000) throw Error('Submission capacity exhausted');
          const admitted = { hostId, clientId, command, status: 'admitted', message: '' };
          db.prepare('INSERT INTO submissions VALUES (?, ?, ?)').run(command.commandId, JSON.stringify(admitted), association.body);
          value = { fresh: true, receipt: admitted };
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } else if (operation === 'outcome') {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT body FROM submissions WHERE id=?').get(receipt.command.commandId);
        if (!row || JSON.stringify(JSON.parse(row.body).command) !== JSON.stringify(receipt.command)) throw Error('Missing or changed submission');
        db.prepare('UPDATE submissions SET body=? WHERE id=?').run(JSON.stringify(receipt), receipt.command.commandId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } else throw Error('Unknown SQLite operation');
    parentPort.postMessage({ id, value });
  } catch (e) { parentPort.postMessage({ id, error: String(e) }); }
});

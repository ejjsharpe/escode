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
    if (!chat || typeof chat.id !== 'string' || !chat.id || chat.id.length > 256 || ids.has(chat.id) ||
        !(chat.project === null || typeof chat.project === 'string') || typeof chat.checkout !== 'string' ||
        typeof chat.draft !== 'string' || !(chat.threadId === null || typeof chat.threadId === 'string') ||
        (chat.title !== undefined && (typeof chat.title !== 'string' || !chat.title.trim() || chat.title.length > 256 || /[\r\n\x00-\x1f]/.test(chat.title))) ||
        (chat.titleSource !== undefined && (typeof chat.titleSource !== 'string' || chat.titleSource.length > 4000)) ||
        (chat.titleRequest !== undefined && (typeof chat.titleRequest !== 'string' || chat.titleRequest.length > 256)) ||
        (chat.phase !== undefined && !['draft', 'bound'].includes(chat.phase)) ||
        (chat.directoryIdentity && (typeof chat.directoryIdentity.path !== 'string' || !Number.isSafeInteger(chat.directoryIdentity.dev) || !Number.isSafeInteger(chat.directoryIdentity.ino)))) throw Error('Malformed draft storage');
    ids.add(chat.id);
  }
};
try {
  if (existsSync(workerData + '.recovery-pending')) throw Error('Recovered state requires external reconciliation before effects');
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
  if (db.prepare('PRAGMA user_version').get().user_version === 3) db.exec('BEGIN IMMEDIATE; CREATE TABLE checkpoints (id TEXT PRIMARY KEY, chatId TEXT NOT NULL, body TEXT NOT NULL); PRAGMA user_version=4; COMMIT');
  if (db.prepare('PRAGMA user_version').get().user_version !== 4 || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Unsupported or corrupt SQLite storage');
  db.exec('CREATE TABLE IF NOT EXISTS checkpoint_policy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), days INTEGER CHECK(days BETWEEN 1 AND 36500)); INSERT OR IGNORE INTO checkpoint_policy VALUES (1,30)');
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
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw error; }
  validate(db.prepare('SELECT body FROM chats').all().map(row => JSON.parse(row.body)));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA checkpoint_fullfsync=ON');
  const settings = { journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, synchronous: db.prepare('PRAGMA synchronous').get().synchronous, checkpointFullfsync: db.prepare('PRAGMA checkpoint_fullfsync').get().checkpoint_fullfsync };
  if (settings.journalMode !== 'wal' || settings.synchronous !== 1 || settings.checkpointFullfsync !== 1) throw Error('SQLite durability settings unavailable');
  db.exec('CREATE TABLE IF NOT EXISTS checkpoint_activity (chatId TEXT PRIMARY KEY, touched INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS rewinds (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS client_recovery (clientId TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(clientId, kind))');
  db.prepare('SELECT id, chatId, body FROM checkpoints LIMIT 1').all();
  // Admission counts protected metadata across every table; exceeding it rolls back the whole mutation.
  const storageBytes = `(SELECT coalesce(sum(length(CAST(body AS BLOB))),0) FROM chats) +
    (SELECT coalesce(sum(length(CAST(body AS BLOB))+length(CAST(association AS BLOB))),0) FROM submissions) +
    (SELECT coalesce(sum(length(CAST(previous AS BLOB))+length(CAST(result AS BLOB))),0) FROM preparation_results) +
    (SELECT coalesce(sum(length(CAST(body AS BLOB))),0) FROM client_recovery)`;
  for (const table of ['chats', 'submissions', 'preparation_results', 'client_recovery']) {
    for (const event of ['INSERT', 'UPDATE']) db.exec(`CREATE TEMP TRIGGER bound_${table}_${event} AFTER ${event} ON ${table}
      BEGIN SELECT CASE WHEN ${storageBytes} > 67108864 OR
      (SELECT count(DISTINCT clientId) FROM client_recovery) > 256 OR
      (SELECT count(*) FROM client_recovery) > 1280
      THEN RAISE(ABORT, 'Aggregate metadata capacity exhausted') END; END`);
  }
  db.exec(`UPDATE submissions SET body=json_set(body, '$.status', 'uncertain', '$.message', 'Host restarted; inspect provider history. Work was not resent.') WHERE json_extract(body, '$.status') IN ('admitted', 'dispatching')`);
  parentPort.postMessage({ id: 0, value: { ...identity[0], settings } });
} catch (e) { parentPort.postMessage({ id: 0, error: String(e) }); db?.close(); process.exitCode = 1; }
if (db && !process.exitCode) parentPort.on('message', ({ id, operation, chats, revision, commandId, command, epoch, hostId, clientId, receipt, previous, result, kind, body }) => {
  try {
    let value;
    if (operation === 'checkpointRetention') {
      if (body !== undefined) {
        if (body.days !== null && (!Number.isSafeInteger(body.days) || body.days < 1 || body.days > 36500)) throw Error('Retention must be 1–36500 whole days or Never');
        db.prepare('UPDATE checkpoint_policy SET days=? WHERE singleton=1').run(body.days);
      }
      value = db.prepare('SELECT days FROM checkpoint_policy WHERE singleton=1').get().days;
    } else if (operation === 'checkpointActivity') {
      if (!Number.isSafeInteger(body.now) || body.now < 0) throw Error('Invalid activity time');
      db.prepare('INSERT INTO checkpoint_activity VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET touched=max(touched,excluded.touched)').run(commandId, body.now);
    } else if (operation === 'expireCheckpoints') {
      if (!Number.isSafeInteger(body.now) || body.now < 0 || !Array.isArray(body.active)) throw Error('Invalid cleanup request');
      db.exec('BEGIN IMMEDIATE');
      try {
        // Recovery/uncertain evidence is deliberately conservative: never infer safety from missing metadata.
        const recovery = db.prepare('SELECT kind, body FROM client_recovery').all().some(row => {
          const saved = JSON.parse(row.body);
          if (row.kind === 'approvals' || row.kind === 'chatClient') return false; // Authority and composer/command identities do not depend on historical file bytes.
          // Completed transfer results retain deduplication; intent/fileFacts separately protect unresolved effects.
          if (row.kind === 'fileCommands') return !Array.isArray(saved) || saved.some(record => !record.result || (record.result.status !== 'accepted' && record.result.status !== 'rejected' && !Array.isArray(record.result.results)) || record.result.status === 'uncertain');
          return row.kind === 'workspace' ? !!saved?.drafts?.length : saved != null && JSON.stringify(saved) !== '{}' && JSON.stringify(saved) !== '[]';
        });
        const uncertain = db.prepare("SELECT 1 FROM rewinds WHERE json_extract(body,'$.result.status')='uncertain' LIMIT 1").get();
        value = 0;
        const days = db.prepare('SELECT days FROM checkpoint_policy WHERE singleton=1').get().days;
        if (days !== null && !recovery && !uncertain && !db.prepare('SELECT 1 FROM preparation_results LIMIT 1').get()) {
          const rows = db.prepare(`SELECT c.id, c.chatId, c.body FROM checkpoints c
            WHERE json_extract(c.body,'$.availability')='available' AND (? IS NULL OR c.id=?)
            AND coalesce((SELECT touched FROM checkpoint_activity WHERE chatId=c.chatId),
              (SELECT max(json_extract(body,'$.createdAt')) FROM checkpoints WHERE chatId=c.chatId)) <= ?
            AND c.chatId NOT IN (SELECT pending.chatId FROM checkpoints pending WHERE json_extract(pending.body,'$.completion')='pending')
            AND c.chatId NOT IN (SELECT value FROM json_each(?))
            AND NOT EXISTS (SELECT 1 FROM submissions WHERE json_extract(body,'$.command.id')=c.chatId
              AND json_extract(body,'$.status') NOT IN ('accepted','rejected'))
            ORDER BY c.rowid LIMIT 100`).all(body.boundary ?? null, body.boundary ?? null, body.now - days * 86400000, JSON.stringify(body.active));
          for (const row of rows) {
            const point = JSON.parse(row.body);
            delete point.files;
            point.availability = 'unavailable';
            point.reason = `File checkpoint expired after ${days} days of chat inactivity`;
            db.prepare('UPDATE checkpoints SET body=? WHERE id=?').run(JSON.stringify(point), row.id);
            value++;
          }
        }
        db.exec('COMMIT');
        // Free database pages remain reusable; truncate only the WAL, without waiting for readers.
        db.exec('PRAGMA busy_timeout=0');
        try { db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); }
        finally { db.exec('PRAGMA busy_timeout=3000'); }
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    } else if (operation === 'rewindRead') {
      const row = db.prepare('SELECT body FROM rewinds WHERE id=?').get(commandId);
      value = row ? JSON.parse(row.body) : null;
    } else if (operation === 'rewindWrite') {
      if (db.prepare('SELECT count(*) AS n FROM rewinds').get().n >= 1000 && !db.prepare('SELECT id FROM rewinds WHERE id=?').get(commandId)) throw Error('Rewind capacity exhausted');
      const encoded = JSON.stringify(body);
      const used = db.prepare('SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS n FROM rewinds WHERE id<>?').get(commandId).n;
      if (used + Buffer.byteLength(encoded) > 67108864) throw Error('Retained branch storage capacity exhausted');
      db.prepare('INSERT INTO rewinds VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(commandId, encoded);
    } else if (operation === 'checkpointPoints') {
      const offset = Number(body.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid checkpoint cursor');
      const rows = db.prepare(`SELECT json_extract(body,'$.id') id, json_extract(body,'$.kind') kind,
        json_extract(body,'$.createdAt') createdAt, json_extract(body,'$.threadId') threadId,
        json_extract(body,'$.turnId') turnId, json_extract(body,'$.commandId') commandId,
        json_extract(body,'$.availability') availability, json_extract(body,'$.reason') reason
        FROM checkpoints WHERE chatId=? AND (? IS NULL OR id=?) ORDER BY rowid LIMIT 21 OFFSET ?`).all(commandId, body.boundary ?? null, body.boundary ?? null, offset);
      value = { points: rows.slice(0,20).map(row => {
        if (!row.turnId && row.commandId) row.turnId = db.prepare("SELECT json_extract(body,'$.turnId') turnId FROM checkpoints WHERE chatId=? AND json_extract(body,'$.commandId')=? AND json_extract(body,'$.kind')='after-turn' LIMIT 1").get(commandId,row.commandId)?.turnId ?? null;
        delete row.commandId;
        return row;
      }), nextCursor: rows.length > 20 ? String(offset + 20) : null };
    } else if (operation === 'inspectCheckpoint') {
      const row = db.prepare('SELECT body FROM checkpoints WHERE chatId=? AND id=?').get(commandId, body.boundary);
      value = row ? JSON.parse(row.body) : null;
    } else if (operation === 'checkpoints') {
      value = db.prepare('SELECT body FROM checkpoints WHERE chatId=? ORDER BY rowid').all(commandId).map(row => JSON.parse(row.body));
    } else if (operation === 'checkpoint' || operation === 'completeCheckpoint') {
      if (!body || !body.id || !body.chatId || !['available', 'unavailable'].includes(body.availability)) throw Error('Invalid checkpoint');
      if (operation === 'completeCheckpoint') {
        const row = db.prepare('SELECT body FROM checkpoints WHERE id=?').get(body.id);
        const prior = row && JSON.parse(row.body);
        if (!prior || prior.completion !== 'pending' || prior.chatId !== body.chatId || prior.threadId !== body.threadId || prior.checkout !== body.checkout || prior.commandId !== body.commandId) throw Error('Completion boundary mismatch or already finalized');
      }
      db.prepare('INSERT INTO checkpoint_activity VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET touched=max(touched,excluded.touched)').run(body.chatId, body.createdAt ?? Date.now());
      const encoded = JSON.stringify(body);
      const used = db.prepare('SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS n FROM checkpoints WHERE id<>?').get(body.id).n;
      if (used + Buffer.byteLength(encoded) > (body.availability === 'available' ? 50331648 : 67108864)) throw Error('Checkpoint storage capacity exhausted');
      if (operation === 'completeCheckpoint') db.prepare('UPDATE checkpoints SET body=? WHERE id=?').run(encoded, body.id);
      else db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?)').run(body.id, body.chatId, encoded);
    } else if (operation === 'publishFileFact') {
      if (!body || !body.completed || !['move', 'trash'].includes(body.kind)) throw Error('Invalid shared file fact');
      db.exec('BEGIN IMMEDIATE');
      try {
        const clients = db.prepare("SELECT DISTINCT clientId FROM client_recovery WHERE kind='workspace' UNION SELECT ? AS clientId").all(clientId);
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
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw error; }
    } else if (operation === 'observePreparation') {
      validate([previous]); validate([result]);
      if (previous.id !== result.id || previous.project !== result.project || previous.checkout !== result.checkout) throw Error('Preparation identity changed');
      const row = db.prepare('SELECT body FROM chats WHERE id=?').get(previous.id);
      if (!row || row.body !== JSON.stringify(previous)) throw Error('Preparation context changed');
      db.prepare('INSERT INTO preparation_results VALUES (?, ?, ?)').run(previous.id, JSON.stringify(previous), JSON.stringify(result));
    } else if (operation === 'recoveryRead' || operation === 'recoveryWrite') {
      if (typeof clientId !== 'string' || !clientId || clientId.length > 256 || !['chatClient', 'workspace', 'intent', 'fileCommands', 'fileFacts', 'approvals'].includes(kind)) throw Error('Invalid recovery owner');
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
        } catch (e) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw e; }
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
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw e; }
    } else if (operation === 'status') {
      const row = db.prepare('SELECT body FROM submissions WHERE id=?').get(commandId);
      value = row ? JSON.parse(row.body) : null;
    } else if (operation === 'admit') {
      if (typeof command.commandId !== 'string' || command.commandId.length > 256) throw Error('Invalid command identity capacity');
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
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw e; }
    } else if (operation === 'outcome') {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT body FROM submissions WHERE id=?').get(receipt.command.commandId);
        if (!row || JSON.stringify(JSON.parse(row.body).command) !== JSON.stringify(receipt.command)) throw Error('Missing or changed submission');
        db.prepare('UPDATE submissions SET body=? WHERE id=?').run(JSON.stringify(receipt), receipt.command.commandId);
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* SQLite may already roll back on ENOSPC. */ } throw e; }
    } else throw Error('Unknown SQLite operation');
    parentPort.postMessage({ id, value });
  } catch (e) { parentPort.postMessage({ id, error: String(e) }); }
});

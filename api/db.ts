import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = path.join(dataDir, 'clinic.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'front_desk')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS equipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'borrowed', 'damaged', 'pending_confirm')),
    deposit_amount REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS borrow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipments(id),
    borrower_name TEXT NOT NULL,
    borrower_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'borrowed' CHECK(status IN ('borrowed', 'returned', 'damaged', 'pending_confirm')),
    borrow_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    return_time TEXT,
    damage_description TEXT,
    deposit_frozen REAL NOT NULL DEFAULT 0,
    deposit_refunded REAL NOT NULL DEFAULT 0,
    deposit_deducted REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS deposit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrow_record_id INTEGER NOT NULL REFERENCES borrow_records(id),
    equipment_id INTEGER NOT NULL REFERENCES equipments(id),
    equipment_name TEXT NOT NULL,
    borrower_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('freeze', 'refund', 'deduct')),
    amount REAL NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrow_record_id INTEGER REFERENCES borrow_records(id),
    equipment_id INTEGER REFERENCES equipments(id),
    action TEXT NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    page TEXT NOT NULL DEFAULT 'equipments',
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    sort_by TEXT,
    sort_order TEXT CHECK(sort_order IN ('asc', 'desc')),
    page_size INTEGER DEFAULT 20,
    visible_columns TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(user_id, page, name)
  );

  CREATE TABLE IF NOT EXISTS view_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    view_id INTEGER NOT NULL REFERENCES saved_views(id),
    view_name TEXT NOT NULL,
    version INTEGER NOT NULL,
    filters TEXT NOT NULL,
    sort_by TEXT,
    sort_order TEXT CHECK(sort_order IN ('asc', 'desc')),
    page_size INTEGER DEFAULT 20,
    visible_columns TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    operator_id INTEGER NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    remark TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_view_snapshots_view_id ON view_snapshots(view_id);

  CREATE TABLE IF NOT EXISTS view_operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    view_id INTEGER REFERENCES saved_views(id),
    view_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'apply', 'snapshot', 'rollback', 'conflict')),
    operator_id INTEGER NOT NULL REFERENCES users(id),
    operator_name TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`)

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
if (userCount.count === 0) {
  const adminHash = bcrypt.hashSync('admin123', 10)
  const frontDeskHash = bcrypt.hashSync('front123', 10)

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  )
  insertUser.run('admin', adminHash, 'admin')
  insertUser.run('front_desk', frontDeskHash, 'front_desk')
}

const equipCount = db.prepare('SELECT COUNT(*) as count FROM equipments').get() as { count: number }
if (equipCount.count === 0) {
  const insertEquip = db.prepare(
    'INSERT INTO equipments (name, type, deposit_amount) VALUES (?, ?, ?)'
  )
  insertEquip.run('轮椅-001', '轮椅', 200)
  insertEquip.run('轮椅-002', '轮椅', 200)
  insertEquip.run('雾化器-001', '雾化器', 150)
  insertEquip.run('血压计-001', '血压计', 100)
}

const columns = db.prepare("PRAGMA table_info(saved_views)").all() as { name: string }[]
const hasVersion = columns.some((c) => c.name === 'version')
if (!hasVersion) {
  db.prepare('ALTER TABLE saved_views ADD COLUMN version INTEGER NOT NULL DEFAULT 1').run()
}

const hasSnapshots = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='view_snapshots'"
).get() as { name: string } | undefined
if (!hasSnapshots) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS view_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      view_id INTEGER NOT NULL REFERENCES saved_views(id),
      view_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      filters TEXT NOT NULL,
      sort_by TEXT,
      sort_order TEXT CHECK(sort_order IN ('asc', 'desc')),
      page_size INTEGER DEFAULT 20,
      visible_columns TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      operator_id INTEGER NOT NULL REFERENCES users(id),
      operator_name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_view_snapshots_view_id ON view_snapshots(view_id);
  `)
}

const logCount = db.prepare('SELECT COUNT(*) as count FROM view_operation_logs').get() as { count: number }
const testLogStmt = db.prepare(`
  INSERT INTO view_operation_logs (view_id, view_name, action, operator_id, operator_name, detail)
  VALUES (NULL, '__migration_test__', 'snapshot', 1, 'migration', 'test')
`)
let needMigrateLogs = false
try {
  const info = db.pragma('foreign_keys = OFF', { simple: true })
  const tx = db.transaction(() => {
    testLogStmt.run()
    db.prepare("DELETE FROM view_operation_logs WHERE view_name = '__migration_test__'").run()
  })
  tx()
} catch {
  needMigrateLogs = true
}
if (needMigrateLogs) {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS view_operation_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        view_id INTEGER REFERENCES saved_views(id),
        view_name TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'apply', 'snapshot', 'rollback', 'conflict')),
        operator_id INTEGER NOT NULL REFERENCES users(id),
        operator_name TEXT NOT NULL,
        detail TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      INSERT INTO view_operation_logs_new SELECT * FROM view_operation_logs;
      DROP TABLE view_operation_logs;
      ALTER TABLE view_operation_logs_new RENAME TO view_operation_logs;
    `)
  })
  tx()
}

export default db
 

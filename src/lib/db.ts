import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'solar.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceSn TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    data TEXT -- JSON string of mapped fields
  );

  CREATE INDEX IF NOT EXISTS idx_history_sn_date ON history(deviceSn, createdAt);
`);

export interface Reading {
  id?: number;
  deviceSn: string;
  createdAt: string;
  data: string;
}

export default db;

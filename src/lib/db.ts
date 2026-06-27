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

  -- Frozen monthly savings snapshots. Once a calendar month has fully elapsed it
  -- is "closed" with the pricing/VAT in effect at the time, so later tariff edits
  -- never change already-billed months. Created automatically on startup.
  CREATE TABLE IF NOT EXISTS monthly_savings (
    deviceSn    TEXT,
    ym          TEXT,            -- 'YYYY-MM'
    kwh         REAL,
    savings     INTEGER,         -- đ, VAT-inclusive
    vatPercent  REAL,
    pricingJson TEXT,            -- snapshot of the tariff used (audit / re-open)
    closedAt    TEXT,
    PRIMARY KEY (deviceSn, ym)
  );
`);

export interface Reading {
  id?: number;
  deviceSn: string;
  createdAt: string;
  data: string;
}

export default db;

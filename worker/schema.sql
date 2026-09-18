-- Sharing D1 schema
CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'TWD',
  group_id TEXT,
  created_by TEXT,
  fund_enabled INTEGER NOT NULL DEFAULT 0,
  fund_custodian TEXT,
  share_default INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  fixed_rates TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledgers_group ON ledgers(group_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_creator ON ledgers(created_by);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  name TEXT NOT NULL,
  line_user_id TEXT,
  avatar TEXT DEFAULT '',
  pay_info TEXT DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_ledger ON members(ledger_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(line_user_id);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','transfer','fund_in')),
  title TEXT,
  category TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  payer_id TEXT NOT NULL,
  split TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_records_ledger ON records(ledger_id, deleted);

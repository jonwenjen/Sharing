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
  merge_currencies INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  fixed_rates TEXT DEFAULT '{}',
  invite_code TEXT,
  group_name TEXT,
  creator_name TEXT,
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

-- 可進入帳本的人（邀請連結或群組成員驗證後加入）
CREATE TABLE IF NOT EXISTS ledger_access (
  ledger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  via TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id)
);

-- 每位 LINE 使用者的個人預設（例如匯款資訊，跨帳本共用）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  pay_info TEXT DEFAULT '{}',
  updated_at INTEGER
);

-- 爬梯子紀錄（後端產生亂數，分享到群組時內容可信）
CREATE TABLE IF NOT EXISTS ladders (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  created_by TEXT,
  data TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- v1.1：帳本固定匯率
ALTER TABLE ledgers ADD COLUMN fixed_rates TEXT DEFAULT '{}';

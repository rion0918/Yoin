CREATE TABLE accounts (
  uid TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting', 'deleted')),
  deletion_requested_at TEXT,
  deleted_at TEXT
);
CREATE TABLE budget_ledger (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  amount_micros INTEGER NOT NULL
);
INSERT INTO budget_ledger (id, status, amount_micros)
SELECT id, status, amount_micros FROM provider_attempts;
CREATE TRIGGER budget_attempt_insert AFTER INSERT ON provider_attempts BEGIN
  INSERT INTO budget_ledger (id, status, amount_micros)
  VALUES (NEW.id, NEW.status, NEW.amount_micros)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount_micros = excluded.amount_micros;
END;
CREATE TRIGGER budget_attempt_update AFTER UPDATE OF status, amount_micros ON provider_attempts BEGIN
  INSERT INTO budget_ledger (id, status, amount_micros)
  VALUES (NEW.id, NEW.status, NEW.amount_micros)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount_micros = excluded.amount_micros;
END;

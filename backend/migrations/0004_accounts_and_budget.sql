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
ALTER TABLE provider_attempts ADD COLUMN ledger_id TEXT;
UPDATE provider_attempts SET ledger_id = lower(hex(randomblob(16)));
INSERT INTO budget_ledger (id, status, amount_micros)
SELECT ledger_id, status, amount_micros FROM provider_attempts;
CREATE TRIGGER budget_attempt_insert AFTER INSERT ON provider_attempts BEGIN
  UPDATE provider_attempts SET ledger_id = lower(hex(randomblob(16)))
  WHERE id = NEW.id AND ledger_id IS NULL;
  INSERT INTO budget_ledger (id, status, amount_micros)
  SELECT ledger_id, status, amount_micros FROM provider_attempts WHERE id = NEW.id
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount_micros = excluded.amount_micros;
END;
CREATE TRIGGER budget_attempt_update AFTER UPDATE OF status, amount_micros ON provider_attempts BEGIN
  INSERT INTO budget_ledger (id, status, amount_micros)
  VALUES (NEW.ledger_id, NEW.status, NEW.amount_micros)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount_micros = excluded.amount_micros;
END;

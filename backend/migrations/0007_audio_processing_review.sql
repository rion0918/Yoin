ALTER TABLE clips ADD COLUMN client_duration_ms INTEGER NOT NULL DEFAULT 0;
UPDATE clips SET client_duration_ms = duration_ms WHERE client_duration_ms = 0;
ALTER TABLE clips ADD COLUMN capture_duration_ms INTEGER;
ALTER TABLE clips ADD COLUMN processing_json TEXT;
ALTER TABLE jobs ADD COLUMN transcript_fingerprint TEXT;
ALTER TABLE jobs ADD COLUMN transcript_reviewed_at TEXT;
ALTER TABLE jobs ADD COLUMN expected_chunks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN completed_chunks INTEGER NOT NULL DEFAULT 0;

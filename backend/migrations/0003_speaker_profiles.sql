CREATE TABLE speaker_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  sample_id TEXT, pending_sample_id TEXT, model_version TEXT, embedding_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX speakers_owner ON speaker_profiles(owner_id, created_at);
CREATE TABLE speaker_samples (
  id TEXT PRIMARY KEY, speaker_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL
);
CREATE INDEX speaker_samples_profile ON speaker_samples(speaker_id, owner_id);
ALTER TABLE utterances ADD COLUMN speaker_profile_id TEXT;
ALTER TABLE utterances ADD COLUMN speaker_name TEXT;
ALTER TABLE jobs ADD COLUMN speaker_snapshot_json TEXT;

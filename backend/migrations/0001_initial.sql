PRAGMA foreign_keys = ON;
CREATE TABLE drafts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
  created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploading',
  lyric_revision INTEGER NOT NULL DEFAULT 0, job_id TEXT, error TEXT
);
CREATE INDEX drafts_owner ON drafts(owner_id, created_at);
CREATE TABLE clips (
  id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), owner_id TEXT NOT NULL,
  mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
  recorded_at TEXT, imported_at TEXT, timezone TEXT NOT NULL, place TEXT,
  object_key TEXT NOT NULL, upload_id TEXT, status TEXT NOT NULL DEFAULT 'uploading',
  inspection_json TEXT
);
CREATE INDEX clips_draft ON clips(draft_id, owner_id);
CREATE TABLE upload_parts (
  clip_id TEXT NOT NULL REFERENCES clips(id), part_number INTEGER NOT NULL,
  etag TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  PRIMARY KEY (clip_id, part_number)
);
CREATE TABLE utterances (
  id TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id),
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX utterances_clip ON utterances(clip_id, start_ms);
CREATE TABLE lyric_revisions (
  draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL,
  blocks_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, revision)
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
  kind TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued', error TEXT,
  lyric_revision INTEGER, blocks_json TEXT, song_id TEXT, created_at TEXT NOT NULL,
  UNIQUE (owner_id, kind, idempotency_key)
);
CREATE INDEX jobs_draft ON jobs(draft_id, owner_id);
CREATE TABLE provider_attempts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), owner_id TEXT NOT NULL,
  stage TEXT NOT NULL, status TEXT NOT NULL, amount_micros INTEGER NOT NULL,
  output_key TEXT, usage_json TEXT, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX attempts_owner ON provider_attempts(owner_id);
CREATE TABLE audio_objects (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
  object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, duration_ms INTEGER NOT NULL, kind TEXT NOT NULL
);
CREATE TABLE songs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
  title TEXT NOT NULL, created_at TEXT NOT NULL, lyric_revision INTEGER NOT NULL,
  audio_id TEXT NOT NULL REFERENCES audio_objects(id)
);
CREATE INDEX songs_owner ON songs(owner_id, created_at);

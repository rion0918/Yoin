CREATE TABLE memory_deletions (
  owner_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deleting', 'failed', 'deleted')),
  error TEXT,
  requested_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (owner_id, draft_id),
  UNIQUE (workflow_id)
);
CREATE INDEX memory_deletions_owner_status
ON memory_deletions(owner_id, status);
CREATE TRIGGER block_deleted_memory_draft
BEFORE INSERT ON drafts
WHEN EXISTS (
  SELECT 1 FROM memory_deletions
  WHERE owner_id = NEW.owner_id AND draft_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_clip
BEFORE INSERT ON clips
WHEN EXISTS (
  SELECT 1 FROM memory_deletions
  WHERE owner_id = NEW.owner_id AND draft_id = NEW.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_job
BEFORE INSERT ON jobs
WHEN EXISTS (
  SELECT 1 FROM memory_deletions
  WHERE owner_id = NEW.owner_id AND draft_id = NEW.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_audio
BEFORE INSERT ON audio_objects
WHEN EXISTS (
  SELECT 1 FROM memory_deletions
  WHERE owner_id = NEW.owner_id AND draft_id = NEW.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_song
BEFORE INSERT ON songs
WHEN EXISTS (
  SELECT 1 FROM memory_deletions
  WHERE owner_id = NEW.owner_id AND draft_id = NEW.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_lyrics
BEFORE INSERT ON lyric_revisions
WHEN EXISTS (
  SELECT 1 FROM memory_deletions m
  JOIN drafts d ON d.id = NEW.draft_id AND d.owner_id = m.owner_id
  WHERE m.draft_id = NEW.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_attempt
BEFORE INSERT ON provider_attempts
WHEN EXISTS (
  SELECT 1 FROM memory_deletions m
  JOIN jobs j ON j.id = NEW.job_id AND j.owner_id = NEW.owner_id
  WHERE m.owner_id = j.owner_id AND m.draft_id = j.draft_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;
CREATE TRIGGER block_deleted_memory_utterance
BEFORE INSERT ON utterances
WHEN EXISTS (
  SELECT 1 FROM memory_deletions m
  JOIN clips c ON c.owner_id = m.owner_id AND c.draft_id = m.draft_id
  WHERE c.id = NEW.clip_id
)
BEGIN SELECT RAISE(ABORT, 'memory_deleted'); END;

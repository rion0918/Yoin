ALTER TABLE jobs ADD COLUMN generation_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN music_preferences_json TEXT;
ALTER TABLE lyric_revisions ADD COLUMN generation_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lyric_revisions ADD COLUMN music_preferences_json TEXT;

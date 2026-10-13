import accountSchema from "../migrations/0004_accounts_and_budget.sql?raw";
import recordingLocationSchema from "../migrations/0006_recording_locations.sql?raw";
import audioProcessingSchema from "../migrations/0007_audio_processing_review.sql?raw";
import songTitleSchema from "../migrations/0008_song_title.sql?raw";
import timingReviewSchema from "../migrations/0009_transcript_timing_review.sql?raw";
import musicSchema from "../migrations/0010_music_generation_input.sql?raw";
import speakerMatchingSchema from "../migrations/0011_speaker_matching_input.sql?raw";

export async function applyAccountSchema(db: D1Database) {
  const [tables, ...triggers] = accountSchema.split("CREATE TRIGGER ");
  const statements = [
    ...tables
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean),
    ...triggers.map((sql) => `CREATE TRIGGER ${sql}`),
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
  await db.batch(
    recordingLocationSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db.batch(
    audioProcessingSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db.batch(
    timingReviewSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db.batch(
    songTitleSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db.batch(
    speakerMatchingSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db.batch(
    musicSchema
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
}

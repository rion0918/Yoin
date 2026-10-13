import assert from "node:assert/strict";
import test from "node:test";
import { draftProgress } from "./draft-progress.ts";

test("home and progress distinguish review, mismatch, recovery and unknown acceptance", () => {
  const draft = {
    status: "needs_reconciliation" as const,
    error: "generated_lyrics_differ",
  };
  assert.equal(draftProgress(draft).label, "生成歌詞の相違を確認");
  assert.equal(
    draftProgress({ ...draft, musicRecoveryAvailable: true }).label,
    "保存済み曲を復旧",
  );
  assert.equal(
    draftProgress({ ...draft, error: "provider_outcome_unconfirmed" }).label,
    "処理の受付確認が必要",
  );
  assert.equal(
    draftProgress({ ...draft, status: "needs_audio_review" }).label,
    "話者と内容を確認",
  );
  assert.equal(
    draftProgress({ ...draft, status: "uploading" }).label,
    "送信を続ける",
  );
  assert.equal(
    draftProgress({ ...draft, status: "waiting_review" }).label,
    "歌詞を確認",
  );
});

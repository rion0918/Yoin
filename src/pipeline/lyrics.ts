import type {
  DraftDocument,
  LyricBlock,
  LyricRevision,
} from "../../shared/contracts.ts";

export async function confirmLyrics(
  api: {
    saveLyrics: (
      id: string,
      revision: number,
      blocks: LyricBlock[],
    ) => Promise<LyricRevision>;
    draft: (id: string) => Promise<DraftDocument>;
  },
  draftId: string,
  revision: number,
  blocks: LyricBlock[],
): Promise<LyricRevision> {
  try {
    return await api.saveLyrics(draftId, revision, blocks);
  } catch (failure) {
    // A response can be lost after the server has committed the new revision.
    const remote = await api.draft(draftId).catch(() => null);
    if (
      remote?.lyrics?.revision === revision + 1 &&
      JSON.stringify(remote.lyrics.blocks) === JSON.stringify(blocks)
    )
      return remote.lyrics;
    throw failure;
  }
}

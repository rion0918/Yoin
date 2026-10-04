import type { MediaContainer } from "./media-container.ts";

export type WorkflowParams = { jobId: string };
export type Env = {
  DB: D1Database;
  AUDIO: R2Bucket;
  PREPARE: Workflow<WorkflowParams>;
  GENERATE: Workflow<WorkflowParams>;
  MEDIA_CONTAINER: DurableObjectNamespace<MediaContainer>;
  OWNER_ID: string;
  TESTER_TOKEN_SHA256: string;
  MEDIA_SIGNING_SECRET: string;
  MEDIA_SERVICE_TOKEN: string;
  GEMINI_API_KEY: string;
  AI_BUDGET_USD: string;
  PUBLIC_API_URL: string;
  MEDIA_API_URL?: string;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export class ReconciliationError extends Error {
  constructor() {
    super("needs_reconciliation");
  }
}

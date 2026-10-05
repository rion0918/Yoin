import { handleRequest } from "./api.ts";
import type { Env } from "./types.ts";

export { DeleteAccountWorkflow } from "./accounts.ts";
export { GenerateWorkflow, PrepareWorkflow } from "./workflows.ts";

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
};

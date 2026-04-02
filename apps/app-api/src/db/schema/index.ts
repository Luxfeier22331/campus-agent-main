export { account, session, user, verification } from "./auth";
export { conversations, messages } from "./chat";
export { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
export {
  officialWebRunProjection,
  officialWebSiteProjection,
  requestAuditProjection,
  requestProjection,
} from "./operator";
export { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

import { account, session, user, verification } from "./auth";
import { conversations, messages } from "./chat";
import { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
import {
  officialWebRunProjection,
  officialWebSiteProjection,
  requestAuditProjection,
  requestProjection,
} from "./operator";
import { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

export const appApiSchema = {
  user,
  session,
  account,
  verification,
  conversations,
  messages,
  crawlRuns,
  runHeartbeats,
  runArtifacts,
  runOutbox,
  requestExecution,
  projectionOutbox,
  requestObservabilityFact,
  requestProjection,
  requestAuditProjection,
  officialWebRunProjection,
  officialWebSiteProjection,
};

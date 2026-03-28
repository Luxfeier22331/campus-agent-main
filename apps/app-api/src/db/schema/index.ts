export { account, session, user, verification } from "./auth";
export { conversations, messages } from "./chat";
export { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
export { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
export { projectionOutbox, requestExecution } from "./runtime";

import { account, session, user, verification } from "./auth";
import { conversations, messages } from "./chat";
import { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
import { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
import { projectionOutbox, requestExecution } from "./runtime";

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
  requestProjection,
  officialWebRunProjection,
  officialWebSiteProjection,
};

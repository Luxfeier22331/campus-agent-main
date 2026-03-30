export { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
export { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
export { projectionOutbox, requestExecution } from "./runtime";

import { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
import { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
import { projectionOutbox, requestExecution } from "./runtime";

export const appApiOwnedSchema = {
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

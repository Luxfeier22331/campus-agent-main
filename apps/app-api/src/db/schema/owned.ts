export { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
export { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
export { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

import { crawlRuns, runArtifacts, runHeartbeats, runOutbox } from "./official-web";
import { officialWebRunProjection, officialWebSiteProjection, requestProjection } from "./operator";
import { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

export const appApiOwnedSchema = {
  crawlRuns,
  runHeartbeats,
  runArtifacts,
  runOutbox,
  requestExecution,
  projectionOutbox,
  requestObservabilityFact,
  requestProjection,
  officialWebRunProjection,
  officialWebSiteProjection,
};

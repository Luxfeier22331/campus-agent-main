export {
	crawlRuns,
	pageFreshness,
	pageObservations,
	runArtifacts,
	runHeartbeats,
	runOutbox,
} from "./official-web";
export {
	metricRollup,
	officialWebRunProjection,
	officialWebSiteProjection,
	qualityBadcaseProjection,
	qualityGradeProjection,
	requestAuditProjection,
	requestProjection,
	traceBacklinkProjection,
} from "./operator";
export { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

import {
	crawlRuns,
	pageFreshness,
	pageObservations,
	runArtifacts,
	runHeartbeats,
	runOutbox,
} from "./official-web";
import {
	metricRollup,
	officialWebRunProjection,
	officialWebSiteProjection,
	qualityBadcaseProjection,
	qualityGradeProjection,
	requestAuditProjection,
	requestProjection,
	traceBacklinkProjection,
} from "./operator";
import { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

export const appApiOwnedSchema = {
	crawlRuns,
	pageObservations,
	pageFreshness,
	runHeartbeats,
	runArtifacts,
	runOutbox,
	requestExecution,
	projectionOutbox,
	requestObservabilityFact,
	requestProjection,
	requestAuditProjection,
	metricRollup,
	qualityBadcaseProjection,
	qualityGradeProjection,
	traceBacklinkProjection,
	officialWebRunProjection,
	officialWebSiteProjection,
};

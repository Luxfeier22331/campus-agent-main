export { account, appAuthSchema, session, user, verification } from "./auth";
export { conversations, messages, sessionSlots } from "./chat";
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

import { account, session, user, verification } from "./auth";
import { conversations, messages, sessionSlots } from "./chat";
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

export const appApiSchema = {
	user,
	session,
	account,
	verification,
	conversations,
	messages,
	sessionSlots,
	crawlRuns,
	runHeartbeats,
	runArtifacts,
	pageObservations,
	pageFreshness,
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

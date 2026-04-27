export {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
} from "./docs";
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
export { profileMemoryItems, profileMemorySettings } from "./profile";
export { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

import {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
} from "./docs";
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
import { profileMemoryItems, profileMemorySettings } from "./profile";
import { projectionOutbox, requestExecution, requestObservabilityFact } from "./runtime";

export const appApiOwnedSchema = {
	crawlRuns,
	pageObservations,
	pageFreshness,
	runHeartbeats,
	runArtifacts,
	runOutbox,
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
	profileMemorySettings,
	profileMemoryItems,
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

export {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
export {
	diningAuditEvents,
	diningDraftVersions,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseCandidates,
	diningReleaseCandidateValidationReports,
	diningReleaseLatestPointer,
	diningReleaseScheduleJobs,
	diningReleaseSnapshots,
	diningReleases,
	diningReviewProjections,
	diningSourceObservations,
	diningSourceSyncRuns,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "./dining";
export {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
} from "./docs";
export {
	identityAccessSnapshots,
	identityAccounts,
	identityFederationClaimsPolicies,
	identityFederationClients,
	identityFederationUserGrants,
	identityPreferenceSettings,
	identityProfiles,
} from "./identity";
export { opsObservabilityReadAudit } from "./ops-observability";
export { profileMemoryItems, profileMemorySettings } from "./profile";
export { providerConfigConnections, providerConfigProfiles } from "./provider-config";
export { requestObservabilityFact } from "./runtime";

import {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
import {
	diningAuditEvents,
	diningDraftVersions,
	diningFloors,
	diningHalls,
	diningMenuItems,
	diningMenuOfferings,
	diningReleaseCandidates,
	diningReleaseCandidateValidationReports,
	diningReleaseLatestPointer,
	diningReleaseScheduleJobs,
	diningReleaseSnapshots,
	diningReleases,
	diningReviewProjections,
	diningSourceObservations,
	diningSourceSyncRuns,
	diningStallProfiles,
	diningWindowAssignments,
	diningWindows,
} from "./dining";
import {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
} from "./docs";
import {
	identityAccessSnapshots,
	identityAccounts,
	identityFederationClaimsPolicies,
	identityFederationClients,
	identityFederationUserGrants,
	identityPreferenceSettings,
	identityProfiles,
} from "./identity";
import { opsObservabilityReadAudit } from "./ops-observability";
import { profileMemoryItems, profileMemorySettings } from "./profile";
import { providerConfigConnections, providerConfigProfiles } from "./provider-config";
import { requestObservabilityFact } from "./runtime";

export const appApiOwnedSchema = {
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
	campusServicesOpsReleases,
	campusServicesOpsAuditEvents,
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
	diningHalls,
	diningFloors,
	diningWindows,
	diningWindowAssignments,
	diningStallProfiles,
	diningMenuItems,
	diningMenuOfferings,
	diningReviewProjections,
	diningSourceObservations,
	diningSourceSyncRuns,
	diningDraftVersions,
	diningReleaseCandidates,
	diningReleaseCandidateValidationReports,
	diningReleaseScheduleJobs,
	diningReleases,
	diningReleaseSnapshots,
	diningReleaseLatestPointer,
	diningAuditEvents,
	identityAccounts,
	identityProfiles,
	identityAccessSnapshots,
	identityPreferenceSettings,
	identityFederationClients,
	identityFederationClaimsPolicies,
	identityFederationUserGrants,
	profileMemorySettings,
	profileMemoryItems,
	opsObservabilityReadAudit,
	providerConfigConnections,
	providerConfigProfiles,
	requestObservabilityFact,
};

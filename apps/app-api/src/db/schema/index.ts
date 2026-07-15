export {
	account,
	appAuthSchema,
	jwks,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
	verification,
} from "./auth";
export {
	transportCurrent,
	transportDepartures,
	transportReleases,
	transportRoutes,
} from "./campus-services";
export {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
export { conversations, messageFeedback, messages, sessionSlots, turnDispatches } from "./chat";
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
	account,
	jwks,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
	verification,
} from "./auth";
import {
	transportCurrent,
	transportDepartures,
	transportReleases,
	transportRoutes,
} from "./campus-services";
import {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
import { conversations, messageFeedback, messages, sessionSlots, turnDispatches } from "./chat";
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

export const appApiSchema = {
	user,
	session,
	account,
	verification,
	oauthClient,
	oauthRefreshToken,
	oauthAccessToken,
	oauthConsent,
	jwks,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
	campusServicesOpsReleases,
	campusServicesOpsAuditEvents,
	transportReleases,
	transportCurrent,
	transportRoutes,
	transportDepartures,
	conversations,
	messageFeedback,
	messages,
	sessionSlots,
	turnDispatches,
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

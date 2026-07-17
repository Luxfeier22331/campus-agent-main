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
	diningPublication,
	diningReleases,
	diningReviews,
} from "./dining";
export {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsReleases,
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
import { diningPublication, diningReleases, diningReviews } from "./dining";
import {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsReleases,
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
	docsReleases,
	docsSearchUnits,
	diningReviews,
	diningReleases,
	diningPublication,
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
	requestObservabilityFact,
};

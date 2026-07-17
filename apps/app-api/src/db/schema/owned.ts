export {
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
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
	campusServicesOpsAuditEvents,
	campusServicesOpsReleases,
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
} from "./campus-services-ops";
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

export const appApiOwnedSchema = {
	campusServicesOpsSourceAttestations,
	campusServicesOpsTransportOverrides,
	campusServicesOpsReleases,
	campusServicesOpsAuditEvents,
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsReleases,
	docsSearchUnits,
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

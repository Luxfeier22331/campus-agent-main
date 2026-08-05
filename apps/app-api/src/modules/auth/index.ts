export type { AppAuth, AppAuthGetter, AppAuthResolutionInput, CreateAppAuthInput } from "./auth";
export {
	buildBetterAuthConfig,
	createAppAuth,
	enforceEndUserEmailAdmission,
	enforceSignupLegalConsent,
	getAppAuth,
	handleAuthRequest,
	hashAppPassword,
	probeAppAuthRuntime,
	resolveEmailVerificationReturnTarget,
	resolvePasswordResetRedirectTarget,
	SIGNUP_LEGAL_CONSENT_HEADER_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
	verifyAppPassword,
} from "./auth";
export type {
	CampusAccessDecision,
	CampusAccessDenialReason,
	CampusAccessUser,
} from "./campus-access";
export {
	assertAccountReady,
	assertCampusUserEligible,
	CAMPUS_EMAIL_DOMAIN,
	evaluateCampusAccess,
	isCampusEmail,
	normalizeCampusEmail,
} from "./campus-access";
export type { OpsAccountAdminApi } from "./ops-account-admin-plugin";
export { getOpsAccountAdminApi } from "./ops-account-admin-plugin";
export type {
	AppPermissions,
	AppPrincipalPayload,
	AppPrincipalType,
	AppSessionPayload,
	AuthorizationProjectionSource,
	BetterAuthSessionPayload,
	CampusIdentityClaimsInput,
	ExecutionActorContext,
	ExecutionAuthorizationContext,
	ExecutionAuthorizationRetrievalFilter,
	ResolvedAppPrincipal,
} from "./principal";
export {
	buildExecutionAuthorizationContext,
	mapSessionToAppPrincipal,
	mapSessionToCampusMemberPrincipal,
	resolveRequestPrincipal,
} from "./principal";

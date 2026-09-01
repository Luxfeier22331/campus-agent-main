export type { AppAuth, AppAuthGetter, AppAuthResolutionInput, CreateAppAuthInput } from "./auth";
export {
	createAppAuth,
	getAppAuth,
	handleAuthRequest,
	probeAppAuthRuntime,
} from "./auth";
export { buildBetterAuthConfig } from "./auth-config";
export { hashAppPassword, verifyAppPassword } from "./auth-password";
export {
	enforceEndUserEmailAdmission,
	enforceSignupLegalConsent,
	SIGNUP_LEGAL_CONSENT_HEADER_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
} from "./auth-policy";
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
	ResolvedAppPrincipal,
} from "./principal";
export {
	buildExecutionAuthorizationContext,
	mapSessionToAppPrincipal,
	mapSessionToCampusMemberPrincipal,
	resolveRequestPrincipal,
} from "./principal";
export {
	resolveEmailVerificationReturnTarget,
	resolvePasswordResetRedirectTarget,
} from "./reset-mail";

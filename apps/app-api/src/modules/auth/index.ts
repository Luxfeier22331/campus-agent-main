export type { AppAuth, AppAuthGetter, AppAuthResolutionInput, CreateAppAuthInput } from "./auth";
export {
	buildBetterAuthConfig,
	createAppAuth,
	getAppAuth,
	handleAuthRequest,
	hashAppPassword,
	probeAppAuthRuntime,
	resolvePasswordResetRedirectTarget,
	verifyAppPassword,
} from "./auth";
export type {
	AppPermissions,
	AppPrincipalPayload,
	AppSessionPayload,
	AuthorizationProjectionSource,
	BetterAuthSessionPayload,
	CampusIdentityClaimsInput,
	ExecutionActorContext,
	ExecutionAuthorizationContext,
	ExecutionAuthorizationRetrievalFilter,
	InternalEvalPrincipalInput,
	OfficialWebCollectorPrincipal,
	ResolvedAppPrincipal,
	WeChatOfficialAccountCollectorPrincipal,
} from "./principal";
export {
	buildExecutionAuthorizationContext,
	buildInternalEvalPrincipal,
	hasMatchingInternalSecret,
	hasTrustedInternalRequest,
	mapOperatorHeadersToPrincipal,
	mapSessionToAppPrincipal,
	mapSessionToCampusMemberPrincipal,
	resolveOfficialWebCollectorPrincipal,
	resolveRequestPrincipal,
	resolveWeChatOfficialAccountCollectorPrincipal,
} from "./principal";

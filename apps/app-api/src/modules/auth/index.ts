export { buildBetterAuthConfig, createAppAuth, getAppAuth, handleAuthRequest } from "./auth";
export {
  mapOperatorHeadersToPrincipal,
  mapSessionToPublicUserPrincipal,
  resolveOfficialWebCollectorPrincipal,
  resolveRequestPrincipal,
} from "./principal";
export type {
  AppPermissions,
  AppPrincipalPayload,
  AppSessionPayload,
  BetterAuthSessionPayload,
  ExecutionActorContext,
  OfficialWebCollectorPrincipal,
  ResolvedAppPrincipal,
} from "./principal";

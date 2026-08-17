import type { ResolvedAppPrincipal } from "./auth/principal";

export interface TurnDispatchPrincipalSnapshot {
	actor: ResolvedAppPrincipal["actor"];
	authorization: ResolvedAppPrincipal["authorization"] | null;
	principal: Pick<ResolvedAppPrincipal["principal"], "displayName" | "principalId" | "type">;
}

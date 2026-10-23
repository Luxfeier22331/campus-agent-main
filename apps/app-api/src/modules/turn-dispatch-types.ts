type TurnDispatchPrincipalType = "campus_member" | "student" | "staff" | "faculty" | "service";

type TurnDispatchAuthorizationProjectionSource = "campus_identity" | "service_auth";

interface TurnDispatchActorSnapshot {
	userId: string;
	principalId: string;
	principalType: TurnDispatchPrincipalType;
	roles: string[];
	departments: string[];
	cohort?: string;
	major?: string;
	program?: string;
}

interface TurnDispatchAuthorizationSnapshot {
	principalId: string;
	projectionSource: TurnDispatchAuthorizationProjectionSource;
	entitlementSnapshotId: string;
	entitlementGroups: string[];
	visibilityScope: string | null;
	applicabilityScope?: string;
	ownershipScopes: string[];
	approvalState: string;
}

interface TurnDispatchPrincipalIdentitySnapshot {
	displayName: string;
	principalId: string;
	type: TurnDispatchPrincipalType;
}

export interface TurnDispatchPrincipalSnapshot {
	actor: TurnDispatchActorSnapshot;
	authorization: TurnDispatchAuthorizationSnapshot | null;
	principal: TurnDispatchPrincipalIdentitySnapshot;
}

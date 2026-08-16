import type { Env } from "../../config";
import { resolveEnvironment } from "../../config";
import { buildEmailAccessService, createPgEmailAccessGrantStore } from "../email-access";
import { type AppAuthResolutionInput, getAppAuth } from "./auth";
import { evaluateCampusAccess } from "./campus-access";

export type AppPrincipalType = "campus_member" | "student" | "staff" | "faculty" | "service";

export type AuthorizationProjectionSource = "campus_identity" | "service_auth";

export interface AppPermissions {
	chat: boolean;
}

export interface AppPrincipalPayload {
	type: AppPrincipalType;
	principalId: string;
	displayName: string;
	email: string | null;
}

export interface AppSessionPayload {
	sessionId: string;
	expiresAt: string;
}

export interface ExecutionActorContext {
	userId: string;
	principalId: string;
	principalType: AppPrincipalType;
	roles: string[];
	departments: string[];
	cohort?: string;
	major?: string;
	program?: string;
}

export interface ExecutionAuthorizationContext {
	principalId: string;
	projectionSource: AuthorizationProjectionSource;
	entitlementSnapshotId: string;
	entitlementGroups: string[];
	visibilityScope: string | null;
	applicabilityScope?: string;
	ownershipScopes: string[];
	approvalState: string;
}

export interface ResolvedAppPrincipal {
	principal: AppPrincipalPayload;
	session: AppSessionPayload | null;
	permissions: AppPermissions;
	actor: ExecutionActorContext;
	authorization?: ExecutionAuthorizationContext;
}

export type BetterAuthSessionPayload = {
	session?: {
		id?: string;
		expiresAt?: string | Date | null;
	} | null;
	user?: {
		banned?: boolean | null;
		id?: string;
		email?: string | null;
		emailVerified?: boolean | null;
		name?: string | null;
		passwordChangeRequired?: boolean | null;
	} | null;
} | null;

export interface CampusIdentityClaimsInput {
	actorRoles?: string[];
	applicabilityScope?: string;
	departments?: string[];
	entitlementGroups?: string[];
	entitlementSnapshotId?: string;
	ownershipScopes?: string[];
	principalType?: Exclude<AppPrincipalType, "service">;
	visibilityScope?: string | null;
}

const ALLOWED_END_USER_PRINCIPAL_TYPES = new Set<AppPrincipalType>([
	"campus_member",
	"student",
	"staff",
	"faculty",
]);

function normalizeHeaderValue(value: string | null): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
	if (!values) {
		return [];
	}

	return values.map((value) => normalizeHeaderValue(value) ?? "").filter((value) => Boolean(value));
}

function toIsoString(value: string | Date | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toAuthorizationProjectionSource(
	principalType: AppPrincipalType,
): AuthorizationProjectionSource {
	switch (principalType) {
		case "campus_member":
		case "student":
		case "staff":
		case "faculty":
			return "campus_identity";
		case "service":
			return "service_auth";
		default:
			return "campus_identity";
	}
}

function defaultEntitlementGroups(principalType: AppPrincipalType): string[] {
	switch (principalType) {
		case "campus_member":
			return ["campus_members"];
		case "student":
			return ["campus_members", "students"];
		case "staff":
			return ["campus_members", "staff"];
		case "faculty":
			return ["campus_members", "faculty"];
		default:
			return [];
	}
}

function mergeEntitlementGroups(
	principalType: AppPrincipalType,
	entitlementGroups: readonly string[],
): string[] {
	return [...new Set([...defaultEntitlementGroups(principalType), ...entitlementGroups])];
}

function buildDefaultEndUserRoles(principalType: AppPrincipalType): string[] {
	switch (principalType) {
		case "student":
			return ["campus_member", "student"];
		case "staff":
			return ["campus_member", "staff"];
		case "faculty":
			return ["campus_member", "faculty"];
		case "campus_member":
			return ["campus_member"];
		default:
			return [principalType];
	}
}

export function buildExecutionAuthorizationContext(
	actor: ExecutionActorContext,
): ExecutionAuthorizationContext {
	const entitlementGroups = defaultEntitlementGroups(actor.principalType);
	return {
		principalId: actor.principalId || actor.userId,
		projectionSource: toAuthorizationProjectionSource(actor.principalType),
		entitlementSnapshotId: "",
		entitlementGroups,
		visibilityScope: null,
		ownershipScopes: [],
		approvalState: "",
	};
}

function buildCampusAuthorizationContext(input: {
	actor: ExecutionActorContext;
	applicabilityScope?: string;
	entitlementGroups: string[];
	entitlementSnapshotId: string;
	ownershipScopes?: string[];
	visibilityScope: string | null;
}): ExecutionAuthorizationContext {
	const entitlementGroups = mergeEntitlementGroups(
		input.actor.principalType,
		input.entitlementGroups,
	);
	return {
		principalId: input.actor.principalId || input.actor.userId,
		projectionSource: toAuthorizationProjectionSource(input.actor.principalType),
		entitlementSnapshotId: input.entitlementSnapshotId,
		entitlementGroups,
		visibilityScope: input.visibilityScope,
		...(input.applicabilityScope ? { applicabilityScope: input.applicabilityScope } : {}),
		ownershipScopes: input.ownershipScopes ?? [],
		approvalState: "",
	};
}

export function mapSessionToCampusMemberPrincipal(
	session: BetterAuthSessionPayload,
	admissionAllowed?: boolean,
): ResolvedAppPrincipal | null {
	const allowed =
		session?.user?.banned !== true &&
		session?.user?.passwordChangeRequired !== true &&
		(admissionAllowed ??
			evaluateCampusAccess({
				...(session?.user?.banned === undefined ? {} : { banned: session.user.banned }),
				...(session?.user?.email === undefined ? {} : { email: session.user.email }),
				...(session?.user?.emailVerified === undefined
					? {}
					: { emailVerified: session.user.emailVerified }),
				...(session?.user?.passwordChangeRequired === undefined
					? {}
					: { passwordChangeRequired: session.user.passwordChangeRequired }),
			}).allowed);
	if (!allowed) {
		return null;
	}
	const userId = normalizeHeaderValue(session?.user?.id ?? null);
	if (!userId) {
		return null;
	}

	const email = normalizeHeaderValue(session?.user?.email ?? null);
	const displayName = normalizeHeaderValue(session?.user?.name ?? null) ?? email ?? userId;
	const sessionId = normalizeHeaderValue(session?.session?.id ?? null);
	const expiresAt = toIsoString(session?.session?.expiresAt ?? null);

	const actor: ExecutionActorContext = {
		userId,
		principalId: userId,
		principalType: "campus_member",
		roles: ["campus_member"],
		departments: [],
	};

	return {
		principal: {
			type: "campus_member",
			principalId: userId,
			displayName,
			email,
		},
		session:
			sessionId && expiresAt
				? {
						sessionId,
						expiresAt,
					}
				: null,
		permissions: {
			chat: true,
		},
		actor,
		authorization: buildExecutionAuthorizationContext(actor),
	};
}

export function mapSessionToAppPrincipal(
	session: BetterAuthSessionPayload,
	campusIdentity?: CampusIdentityClaimsInput,
	admissionAllowed?: boolean,
): ResolvedAppPrincipal | null {
	const campusMemberPrincipal = mapSessionToCampusMemberPrincipal(session, admissionAllowed);
	if (!campusMemberPrincipal) {
		return null;
	}
	if (!campusIdentity) {
		return campusMemberPrincipal;
	}

	const principalType = campusIdentity.principalType ?? "campus_member";
	if (!ALLOWED_END_USER_PRINCIPAL_TYPES.has(principalType)) {
		return campusMemberPrincipal;
	}

	const actorRoles = normalizeStringList(campusIdentity.actorRoles);
	const departments = normalizeStringList(campusIdentity.departments);
	const entitlementGroups = normalizeStringList(campusIdentity.entitlementGroups);
	const ownershipScopes = normalizeStringList(campusIdentity.ownershipScopes);
	const visibilityScope = normalizeHeaderValue(campusIdentity.visibilityScope ?? null);
	const entitlementSnapshotId =
		normalizeHeaderValue(campusIdentity.entitlementSnapshotId ?? null) ?? "";
	const applicabilityScope =
		normalizeHeaderValue(campusIdentity.applicabilityScope ?? null) ?? undefined;

	const actor: ExecutionActorContext = {
		userId: campusMemberPrincipal.actor.userId,
		principalId: campusMemberPrincipal.actor.principalId,
		principalType,
		roles: actorRoles.length > 0 ? actorRoles : buildDefaultEndUserRoles(principalType),
		departments,
	};

	return {
		...campusMemberPrincipal,
		principal: {
			...campusMemberPrincipal.principal,
			type: principalType,
		},
		actor,
		authorization: buildCampusAuthorizationContext({
			actor,
			...(applicabilityScope ? { applicabilityScope } : {}),
			entitlementGroups,
			entitlementSnapshotId,
			ownershipScopes,
			visibilityScope,
		}),
	};
}

export async function resolveRequestPrincipal(
	request: Request,
	env: Env,
	input: AppAuthResolutionInput = {},
): Promise<ResolvedAppPrincipal | null> {
	const auth = input.getAppAuth ? await input.getAppAuth() : await getAppAuth(env);
	const session = await auth.api.getSession({
		headers: request.headers,
	});
	if (!session?.user) {
		return null;
	}
	const emailAccessService =
		input.emailAccessService ??
		buildEmailAccessService({
			environment: resolveEnvironment(env),
			store: createPgEmailAccessGrantStore(env),
		});
	const decision = await emailAccessService.evaluateAccountAccess(session.user);
	return mapSessionToAppPrincipal(session, undefined, decision.allowed);
}

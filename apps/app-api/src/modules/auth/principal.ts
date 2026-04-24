import { timingSafeEqual } from "node:crypto";

import { type Env, parseCsvList } from "../../config";
import { AppApiRouteError } from "../../http";
import { type AppAuthResolutionInput, getAppAuth } from "./auth";

export type AppPrincipalType =
	| "campus_member"
	| "student"
	| "staff"
	| "faculty"
	| "operator"
	| "service";

export type AuthorizationProjectionSource = "campus_identity" | "operator_headers" | "service_auth";

export interface OfficialWebCollectorPrincipal {
	kind: "service";
	serviceClass: "official_web_collector";
	serviceId: "official-web-collector";
}

export interface AppPermissions {
	chat: boolean;
	operator: boolean;
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

export interface ExecutionAuthorizationRetrievalFilter {
	entitlementGroups: string[];
	policyProjectionVersion: string;
	visibilityLevel: string;
	visibilityScope: string | null;
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
	retrievalFilter: ExecutionAuthorizationRetrievalFilter;
}

export interface ResolvedAppPrincipal {
	principal: AppPrincipalPayload;
	session: AppSessionPayload | null;
	permissions: AppPermissions;
	actor: ExecutionActorContext;
	authorization?: ExecutionAuthorizationContext;
}

export interface InternalEvalPrincipalInput {
	email: string;
	principalId?: string;
	displayName?: string;
	principalType?: Extract<AppPrincipalType, "campus_member" | "student" | "staff" | "faculty">;
	actorRoles?: string[];
	departments?: string[];
	cohort?: string;
	major?: string;
	program?: string;
	entitlementGroups?: string[];
	entitlementSnapshotId?: string;
	visibilityLevel?: string;
	visibilityScope?: string | null;
	applicabilityScope?: string;
	ownershipScopes?: string[];
}

export type BetterAuthSessionPayload = {
	session?: {
		id?: string;
		expiresAt?: string | Date | null;
	} | null;
	user?: {
		id?: string;
		email?: string | null;
		name?: string | null;
	} | null;
} | null;

export interface CampusIdentityClaimsInput {
	actorRoles?: string[];
	applicabilityScope?: string;
	departments?: string[];
	entitlementGroups?: string[];
	entitlementSnapshotId?: string;
	ownershipScopes?: string[];
	principalType?: Exclude<AppPrincipalType, "operator" | "service">;
	visibilityLevel?: string;
	visibilityScope?: string | null;
}

const DEFAULT_POLICY_PROJECTION_VERSION = "phase1-authorization-projection-v1";
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

function normalizeEmail(value: string | null): string | null {
	const normalized = normalizeHeaderValue(value);
	return normalized ? normalized.toLowerCase() : null;
}

function decodeOptionalHeaderValue(value: string | null): string | null {
	const normalized = normalizeHeaderValue(value);
	if (!normalized) {
		return null;
	}

	if (!normalized.toLowerCase().startsWith("b64:")) {
		return normalized;
	}

	try {
		const decoded = Buffer.from(normalized.slice(4), "base64").toString("utf8").trim();
		return decoded || null;
	} catch {
		return null;
	}
}

export function hasMatchingInternalSecret(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET">,
): boolean {
	const expected = normalizeHeaderValue(env.APP_API_INTERNAL_SHARED_SECRET ?? null);
	const provided = normalizeHeaderValue(request.headers.get("x-app-internal-auth"));
	if (!(expected && provided)) {
		return false;
	}

	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	if (expectedBytes.length !== providedBytes.length) {
		return false;
	}

	return timingSafeEqual(expectedBytes, providedBytes);
}

export function hasTrustedInternalRequest(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET">,
): boolean {
	return hasMatchingInternalSecret(request, env);
}

function parseHeaderList(request: Request, headerName: string): string[] {
	return parseCsvList(request.headers.get(headerName) ?? undefined);
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
	if (!values) {
		return [];
	}

	return values.map((value) => normalizeHeaderValue(value) ?? "").filter((value) => Boolean(value));
}

function isCampusEndUserPrincipalType(
	value: string,
): value is Exclude<AppPrincipalType, "operator" | "service"> {
	return ALLOWED_END_USER_PRINCIPAL_TYPES.has(value as AppPrincipalType);
}

function hasMatchingBearerToken(request: Request, token: string | null): boolean {
	const expected = normalizeHeaderValue(token);
	const authorization = normalizeHeaderValue(request.headers.get("authorization"));
	if (!(expected && authorization)) {
		return false;
	}
	if (!authorization.toLowerCase().startsWith("bearer ")) {
		return false;
	}

	const provided = normalizeHeaderValue(authorization.slice("bearer ".length));
	if (!provided) {
		return false;
	}

	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	if (expectedBytes.length !== providedBytes.length) {
		return false;
	}

	return timingSafeEqual(expectedBytes, providedBytes);
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
		case "operator":
			return "operator_headers";
		case "service":
			return "service_auth";
		default:
			return "campus_identity";
	}
}

function defaultEntitlementGroups(principalType: AppPrincipalType): string[] {
	switch (principalType) {
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

function hasDefaultCampusAuthorization(principalType: AppPrincipalType): boolean {
	return defaultEntitlementGroups(principalType).length > 0;
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
		retrievalFilter: {
			entitlementGroups,
			policyProjectionVersion: DEFAULT_POLICY_PROJECTION_VERSION,
			visibilityLevel: "public",
			visibilityScope: null,
		},
	};
}

function buildCampusAuthorizationContext(input: {
	actor: ExecutionActorContext;
	applicabilityScope?: string;
	entitlementGroups: string[];
	entitlementSnapshotId: string;
	ownershipScopes?: string[];
	visibilityLevel?: string;
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
		applicabilityScope: input.applicabilityScope,
		ownershipScopes: input.ownershipScopes ?? [],
		approvalState: "",
		retrievalFilter: {
			entitlementGroups,
			policyProjectionVersion: DEFAULT_POLICY_PROJECTION_VERSION,
			visibilityLevel: input.visibilityLevel?.trim() || "public",
			visibilityScope: input.visibilityScope,
		},
	};
}

export function buildInternalEvalPrincipal(
	input: InternalEvalPrincipalInput,
): ResolvedAppPrincipal {
	const principalType = input.principalType ?? "campus_member";
	const normalizedEmail = normalizeEmail(input.email);
	if (!normalizedEmail) {
		throw new Error("internal eval principal email is required");
	}

	const principalId = normalizeHeaderValue(input.principalId ?? null) ?? normalizedEmail;
	const displayName = normalizeHeaderValue(input.displayName ?? null) ?? normalizedEmail;
	const roles = normalizeStringList(input.actorRoles);
	const departments = normalizeStringList(input.departments);
	const actor: ExecutionActorContext = {
		userId: principalId,
		principalId,
		principalType,
		roles: roles.length > 0 ? roles : buildDefaultEndUserRoles(principalType),
		departments,
		cohort: decodeOptionalHeaderValue(input.cohort ?? null) ?? undefined,
		major: decodeOptionalHeaderValue(input.major ?? null) ?? undefined,
		program: decodeOptionalHeaderValue(input.program ?? null) ?? undefined,
	};

	const entitlementGroups = normalizeStringList(input.entitlementGroups);
	const entitlementSnapshotId = normalizeHeaderValue(input.entitlementSnapshotId ?? null) ?? "";
	const visibilityScope = normalizeHeaderValue(input.visibilityScope ?? null);
	const visibilityLevel = normalizeHeaderValue(input.visibilityLevel ?? null) ?? "public";
	const applicabilityScope = normalizeHeaderValue(input.applicabilityScope ?? null) ?? undefined;
	const ownershipScopes = normalizeStringList(input.ownershipScopes);

	const authorization =
		entitlementSnapshotId ||
		entitlementGroups.length > 0 ||
		visibilityScope !== null ||
		applicabilityScope !== undefined ||
		ownershipScopes.length > 0 ||
		hasDefaultCampusAuthorization(principalType)
			? buildCampusAuthorizationContext({
					actor,
					applicabilityScope,
					entitlementGroups,
					entitlementSnapshotId,
					ownershipScopes,
					visibilityLevel,
					visibilityScope,
				})
			: buildExecutionAuthorizationContext(actor);

	return {
		principal: {
			type: principalType,
			principalId,
			displayName,
			email: normalizedEmail,
		},
		session: null,
		permissions: {
			chat: true,
			operator: false,
		},
		actor,
		authorization,
	};
}

export function mapSessionToCampusMemberPrincipal(
	session: BetterAuthSessionPayload,
): ResolvedAppPrincipal | null {
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
			operator: false,
		},
		actor,
		authorization: buildExecutionAuthorizationContext(actor),
	};
}

export function mapSessionToAppPrincipal(
	session: BetterAuthSessionPayload,
	campusIdentity?: CampusIdentityClaimsInput,
): ResolvedAppPrincipal | null {
	const campusMemberPrincipal = mapSessionToCampusMemberPrincipal(session);
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
			applicabilityScope,
			entitlementGroups,
			entitlementSnapshotId,
			ownershipScopes,
			visibilityLevel: campusIdentity.visibilityLevel,
			visibilityScope,
		}),
	};
}

function parseCampusIdentityClaims(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET">,
): CampusIdentityClaimsInput | undefined {
	if (!hasMatchingInternalSecret(request, env)) {
		return;
	}

	const principalType = normalizeHeaderValue(request.headers.get("x-app-campus-principal-type"));
	const entitlementSnapshotId = normalizeHeaderValue(
		request.headers.get("x-app-campus-entitlement-snapshot-id"),
	);
	const visibilityScope = normalizeHeaderValue(
		request.headers.get("x-app-campus-visibility-scope"),
	);
	const applicabilityScope = normalizeHeaderValue(
		request.headers.get("x-app-campus-applicability-scope"),
	);
	const visibilityLevel = normalizeHeaderValue(
		request.headers.get("x-app-campus-visibility-level"),
	);

	const claims: CampusIdentityClaimsInput = {
		actorRoles: parseHeaderList(request, "x-app-campus-actor-roles"),
		applicabilityScope: applicabilityScope ?? undefined,
		departments: parseHeaderList(request, "x-app-campus-departments"),
		entitlementGroups: parseHeaderList(request, "x-app-campus-entitlement-groups"),
		entitlementSnapshotId: entitlementSnapshotId ?? undefined,
		ownershipScopes: parseHeaderList(request, "x-app-campus-ownership-scopes"),
		visibilityLevel: visibilityLevel ?? undefined,
		visibilityScope,
	};

	if (principalType && isCampusEndUserPrincipalType(principalType)) {
		claims.principalType = principalType;
	}

	const hasMaterialClaims = Boolean(
		claims.principalType ||
			claims.entitlementSnapshotId ||
			claims.visibilityScope ||
			claims.applicabilityScope ||
			claims.visibilityLevel ||
			(claims.actorRoles?.length ?? 0) > 0 ||
			(claims.departments?.length ?? 0) > 0 ||
			(claims.entitlementGroups?.length ?? 0) > 0 ||
			(claims.ownershipScopes?.length ?? 0) > 0,
	);

	return hasMaterialClaims ? claims : undefined;
}

type OperatorHeadersAdmission =
	| { kind: "absent" }
	| { kind: "internal_auth_required" }
	| { kind: "not_admitted" }
	| { kind: "admitted"; principal: ResolvedAppPrincipal };

function isOperatorRouteRequest(request: Request): boolean {
	const pathname = new URL(request.url).pathname;
	return pathname.startsWith("/api/operator/");
}

function buildOperatorPrincipal(request: Request, email: string): ResolvedAppPrincipal {
	const principalId = normalizeHeaderValue(request.headers.get("x-app-operator-id")) ?? email;
	const displayName = normalizeHeaderValue(request.headers.get("x-app-operator-name")) ?? email;
	const roles = parseHeaderList(request, "x-app-operator-roles");
	const departments = parseHeaderList(request, "x-app-operator-departments");

	const actor: ExecutionActorContext = {
		userId: principalId,
		principalId,
		principalType: "operator",
		roles,
		departments,
	};

	return {
		principal: {
			type: "operator",
			principalId,
			displayName,
			email,
		},
		session: null,
		permissions: {
			chat: false,
			operator: true,
		},
		actor,
		authorization: buildExecutionAuthorizationContext(actor),
	};
}

function resolveOperatorHeadersAdmission(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET" | "APP_API_OPERATOR_EMAIL_ALLOWLIST">,
): OperatorHeadersAdmission {
	const email = normalizeEmail(request.headers.get("x-app-operator-email"));
	if (!email) {
		return { kind: "absent" };
	}
	if (!hasMatchingInternalSecret(request, env)) {
		return { kind: "internal_auth_required" };
	}

	const allowlist = parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).map((item) =>
		item.toLowerCase(),
	);
	if (allowlist.length === 0 || !allowlist.includes(email)) {
		return { kind: "not_admitted" };
	}

	return {
		kind: "admitted",
		principal: buildOperatorPrincipal(request, email),
	};
}

export function mapOperatorHeadersToPrincipal(
	request: Request,
	env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET" | "APP_API_OPERATOR_EMAIL_ALLOWLIST">,
): ResolvedAppPrincipal | null {
	const operatorHeadersAdmission = resolveOperatorHeadersAdmission(request, env);
	return operatorHeadersAdmission.kind === "admitted" ? operatorHeadersAdmission.principal : null;
}

export async function resolveOfficialWebCollectorPrincipal(
	request: Request,
	env: Pick<Env, "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN">,
): Promise<OfficialWebCollectorPrincipal | null> {
	if (!hasMatchingBearerToken(request, env.APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN ?? null)) {
		return null;
	}

	return {
		kind: "service",
		serviceClass: "official_web_collector",
		serviceId: "official-web-collector",
	};
}

export async function resolveRequestPrincipal(
	request: Request,
	env: Env,
	input: AppAuthResolutionInput = {},
): Promise<ResolvedAppPrincipal | null> {
	const operatorHeadersAdmission = resolveOperatorHeadersAdmission(request, env);
	if (operatorHeadersAdmission.kind === "admitted") {
		return operatorHeadersAdmission.principal;
	}

	if (isOperatorRouteRequest(request)) {
		if (operatorHeadersAdmission.kind === "internal_auth_required") {
			throw new AppApiRouteError({
				code: "internal_auth_required",
				message: "Trusted internal shared secret required.",
				retryable: false,
				status: 401,
			});
		}

		if (operatorHeadersAdmission.kind === "not_admitted") {
			throw new AppApiRouteError({
				code: "operator_identity_not_admitted",
				message: "Operator identity is not admitted for panel access.",
				retryable: false,
				status: 403,
			});
		}
	}

	const auth = input.getAppAuth ? await input.getAppAuth() : await getAppAuth(env);
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	return mapSessionToAppPrincipal(session, parseCampusIdentityClaims(request, env));
}

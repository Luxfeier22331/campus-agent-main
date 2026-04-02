import { timingSafeEqual } from "node:crypto";

import { parseCsvList, type Env } from "../../config";
import { getAppAuth } from "./auth";

export type AppPrincipalType =
  | "public_user"
  | "campus_member"
  | "student"
  | "staff"
  | "faculty"
  | "operator"
  | "service";

export type AuthorizationProjectionSource =
  | "public_session"
  | "campus_identity"
  | "operator_headers"
  | "service_auth";

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
  groups: string[];
  campusScope: string | null;
}

export interface ExecutionAuthorizationRetrievalFilter {
  aclGroups: string[];
  campusScope: string | null;
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

export type BetterAuthSessionPayload =
  | {
      session?: {
        id?: string;
        expiresAt?: string | Date | null;
      } | null;
      user?: {
        id?: string;
        email?: string | null;
        name?: string | null;
      } | null;
    }
  | null;

export interface CampusIdentityClaimsInput {
  actorGroups?: string[];
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
  "public_user",
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

function hasMatchingInternalSecret(
  request: Request,
  env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET">,
): boolean {
  const expected = normalizeHeaderValue(env.APP_API_INTERNAL_SHARED_SECRET ?? null);
  const provided = normalizeHeaderValue(request.headers.get("x-app-internal-auth"));
  if (!expected || !provided) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, providedBytes);
}

function parseHeaderList(request: Request, headerName: string): string[] {
  return parseCsvList(request.headers.get(headerName) ?? undefined);
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return values
    .map((value) => normalizeHeaderValue(value) ?? "")
    .filter((value) => Boolean(value));
}

function isCampusEndUserPrincipalType(value: string): value is Exclude<AppPrincipalType, "operator" | "service"> {
  return ALLOWED_END_USER_PRINCIPAL_TYPES.has(value as AppPrincipalType);
}

function hasMatchingBearerToken(
  request: Request,
  token: string | null,
): boolean {
  const expected = normalizeHeaderValue(token);
  const authorization = normalizeHeaderValue(request.headers.get("authorization"));
  if (!expected || !authorization) {
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
    case "public_user":
    default:
      return "public_session";
  }
}

export function buildExecutionAuthorizationContext(
  actor: ExecutionActorContext,
): ExecutionAuthorizationContext {
  return {
    principalId: actor.principalId || actor.userId,
    projectionSource: toAuthorizationProjectionSource(actor.principalType),
    entitlementSnapshotId: "",
    entitlementGroups: [],
    visibilityScope: null,
    ownershipScopes: [],
    approvalState: "",
    retrievalFilter: {
      aclGroups: [],
      campusScope: null,
      entitlementGroups: [],
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
  return {
    principalId: input.actor.principalId || input.actor.userId,
    projectionSource: toAuthorizationProjectionSource(input.actor.principalType),
    entitlementSnapshotId: input.entitlementSnapshotId,
    entitlementGroups: input.entitlementGroups,
    visibilityScope: input.visibilityScope,
    applicabilityScope: input.applicabilityScope,
    ownershipScopes: input.ownershipScopes ?? [],
    approvalState: "",
    retrievalFilter: {
      aclGroups: [],
      campusScope: null,
      entitlementGroups: input.entitlementGroups,
      policyProjectionVersion: DEFAULT_POLICY_PROJECTION_VERSION,
      visibilityLevel: input.visibilityLevel?.trim() || "public",
      visibilityScope: input.visibilityScope,
    },
  };
}

export function mapSessionToPublicUserPrincipal(
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
    principalType: "public_user",
    roles: ["public_user"],
    departments: [],
    groups: ["public_chat_users"],
    campusScope: null,
  };

  return {
    principal: {
      type: "public_user",
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
  const publicPrincipal = mapSessionToPublicUserPrincipal(session);
  if (!publicPrincipal) {
    return null;
  }
  if (!campusIdentity) {
    return publicPrincipal;
  }

  const principalType = campusIdentity.principalType ?? "public_user";
  if (!ALLOWED_END_USER_PRINCIPAL_TYPES.has(principalType)) {
    return publicPrincipal;
  }
  if (principalType === "public_user") {
    return publicPrincipal;
  }

  const actorGroups = normalizeStringList(campusIdentity.actorGroups);
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
    userId: publicPrincipal.actor.userId,
    principalId: publicPrincipal.actor.principalId,
    principalType,
    roles: actorRoles.length > 0 ? actorRoles : [principalType],
    departments,
    groups: actorGroups,
    campusScope: visibilityScope,
  };

  return {
    ...publicPrincipal,
    principal: {
      ...publicPrincipal.principal,
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
    return undefined;
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
    actorGroups: parseHeaderList(request, "x-app-campus-actor-groups"),
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
      claims.actorGroups?.length ||
      claims.actorRoles?.length ||
      claims.departments?.length ||
      claims.entitlementGroups?.length ||
      claims.ownershipScopes?.length,
  );

  return hasMaterialClaims ? claims : undefined;
}

export function mapOperatorHeadersToPrincipal(
  request: Request,
  env: Pick<Env, "APP_API_INTERNAL_SHARED_SECRET" | "APP_API_OPERATOR_EMAIL_ALLOWLIST">,
): ResolvedAppPrincipal | null {
  const email = normalizeEmail(request.headers.get("x-app-operator-email"));
  if (!email) {
    return null;
  }
  if (!hasMatchingInternalSecret(request, env)) {
    return null;
  }

  const allowlist = parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).map((item) =>
    item.toLowerCase(),
  );
  if (allowlist.length === 0 || !allowlist.includes(email)) {
    return null;
  }

  const principalId =
    normalizeHeaderValue(request.headers.get("x-app-operator-id")) ?? email;
  const displayName =
    normalizeHeaderValue(request.headers.get("x-app-operator-name")) ?? email;
  const groups = parseHeaderList(request, "x-app-operator-groups");
  const roles = parseHeaderList(request, "x-app-operator-roles");
  const departments = parseHeaderList(request, "x-app-operator-departments");
  const campusScope = normalizeHeaderValue(request.headers.get("x-app-operator-campus-scope"));

  const actor: ExecutionActorContext = {
    userId: principalId,
    principalId,
    principalType: "operator",
    roles,
    departments,
    groups,
    campusScope,
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
): Promise<ResolvedAppPrincipal | null> {
  const operatorPrincipal = mapOperatorHeadersToPrincipal(request, env);
  if (operatorPrincipal) {
    return operatorPrincipal;
  }

  const auth = await getAppAuth(env);
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return mapSessionToAppPrincipal(session, parseCampusIdentityClaims(request, env));
}

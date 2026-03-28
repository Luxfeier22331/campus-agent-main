import { timingSafeEqual } from "node:crypto";

import { parseCsvList, type Env } from "../../config";
import { getAppAuth } from "./auth";

export type AppPrincipalType = "public_user" | "operator";

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
  roles: string[];
  departments: string[];
  groups: string[];
  campusScope: string | null;
  snapshot: Record<string, unknown>;
}

export interface ResolvedAppPrincipal {
  principal: AppPrincipalPayload;
  session: AppSessionPayload | null;
  permissions: AppPermissions;
  actor: ExecutionActorContext;
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

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
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
    actor: {
      userId,
      roles: ["public_user"],
      departments: [],
      groups: ["public_chat_users"],
      campusScope: null,
      snapshot: {
        principal_type: "public_user",
        display_name: displayName,
        email,
      },
    },
  };
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
    actor: {
      userId: principalId,
      roles,
      departments,
      groups,
      campusScope,
      snapshot: {
        principal_type: "operator",
        display_name: displayName,
        email,
        source: "trusted_operator_bridge",
      },
    },
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

  return mapSessionToPublicUserPrincipal(session);
}

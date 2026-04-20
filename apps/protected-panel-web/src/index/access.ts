import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import {
  CLOUDFLARE_ACCESS_ENVELOPE,
  JWKS_BY_ISSUER,
  PLACEHOLDER_ACCESS_POLICY_AUD,
  PLACEHOLDER_ACCESS_TEAM_DOMAIN,
  REQUIRED_PROTECTION_ENVELOPE,
  type Env,
  type OperatorContext,
} from "./types";
import { protectionNotConfiguredResponse, textResponse } from "./responses";

export function normalizeConfiguredAccessTeamDomain(
  teamDomain: string | undefined,
): string | null {
  const trimmed = teamDomain?.trim();
  if (!trimmed) {
    return null;
  }

  let normalized: string;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    normalized = parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }

  return normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN ? null : normalized;
}

export function normalizeConfiguredAccessPolicyAud(
  audience: string | undefined,
): string | null {
  const trimmed = audience?.trim();
  if (!trimmed || trimmed === PLACEHOLDER_ACCESS_POLICY_AUD) {
    return null;
  }

  return trimmed;
}

export function resolveAccessAssertion(request: Request): string | null {
  const headerToken = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (headerToken) {
    return headerToken;
  }

  return readCookieValue(request.headers.get("cookie"), "CF_Authorization");
}

export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = segment.slice(0, separatorIndex).trim();
    if (cookieName !== name) {
      continue;
    }

    const cookieValue = segment.slice(separatorIndex + 1).trim();
    return cookieValue || null;
  }

  return null;
}

export function getMissingAccessConfig(env: Env): string[] {
  const missing: string[] = [];

  if (env.PANEL_PROTECTION_ENVELOPE !== CLOUDFLARE_ACCESS_ENVELOPE) {
    missing.push(REQUIRED_PROTECTION_ENVELOPE);
  }
  if (!normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN)) {
    missing.push("ACCESS_TEAM_DOMAIN");
  }
  if (!normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD)) {
    missing.push("ACCESS_POLICY_AUD");
  }

  return missing;
}

function mapOperatorContext(payload: JWTPayload): OperatorContext {
  const subject = String(payload.sub || "");
  const email = typeof payload.email === "string" ? payload.email : "";
  const displayName = typeof payload.name === "string" ? payload.name : null;
  const groups = Array.isArray(payload.groups)
    ? payload.groups.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  return {
    display_name: displayName,
    email: email || null,
    groups,
    operator_id: email || subject,
    principal_class: "human",
    subject,
  };
}

function getRemoteJwks(issuer: string) {
  const cached = JWKS_BY_ISSUER.get(issuer);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  JWKS_BY_ISSUER.set(issuer, jwks);
  return jwks;
}

export async function validateProtectedApiRequest(
  request: Request,
  env: Env,
): Promise<{ error: Response | null; operatorContext: OperatorContext | null }> {
  const missingAccessConfig = getMissingAccessConfig(env);
  if (missingAccessConfig.length > 0) {
    return {
      error: protectionNotConfiguredResponse(missingAccessConfig),
      operatorContext: null,
    };
  }

  const token = resolveAccessAssertion(request);
  if (!token) {
    return {
      error: textResponse("Missing Access JWT.", 401),
      operatorContext: null,
    };
  }

  const issuer = normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD);
  if (!issuer || !audience) {
    return {
      error: protectionNotConfiguredResponse(getMissingAccessConfig(env)),
      operatorContext: null,
    };
  }

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
      issuer,
      audience,
    });
    return {
      error: null,
      operatorContext: mapOperatorContext(payload),
    };
  } catch {
    return {
      error: textResponse("Invalid Access JWT.", 401),
      operatorContext: null,
    };
  }
}

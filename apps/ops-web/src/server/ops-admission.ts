import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

const PLACEHOLDER_ACCESS_POLICY_AUD = "ops-web-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface OpsAdmissionEnv {
	ACCESS_POLICY_AUD?: string;
	ACCESS_TEAM_DOMAIN?: string;
	DEPLOYMENT_ENVIRONMENT?: string;
}

export interface OpsOperatorContext {
	displayName: string | null;
	email: string | null;
	operatorId: string;
	subject: string;
}

export interface OpsAdmission {
	admit(request: Request): Promise<OpsAdmissionResult>;
}

export type OpsAdmissionResult =
	| { operator: OpsOperatorContext; response: null }
	| { operator: null; response: Response };

export function createCloudflareAccessOpsAdmission(
	env: OpsAdmissionEnv = process.env,
): OpsAdmission {
	return { admit: async (request) => await validateCloudflareAccessRequest(request, env) };
}

export function createOpsAdmissionFromEnv(env: OpsAdmissionEnv = process.env): OpsAdmission {
	const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
	if (deploymentEnvironment === "local" || deploymentEnvironment === "development") {
		return createAllowAllOpsAdmission({
			displayName: "Local Operator",
			email: "local@localhost",
			operatorId: "local",
			subject: "local",
		});
	}
	return createCloudflareAccessOpsAdmission(env);
}

export function createAllowAllOpsAdmission(operator?: Partial<OpsOperatorContext>): OpsAdmission {
	return {
		async admit() {
			return {
				operator: {
					displayName: operator?.displayName ?? "Fixture Operator",
					email: operator?.email ?? "ops@example.test",
					operatorId: operator?.operatorId ?? "ops@example.test",
					subject: operator?.subject ?? "fixture-operator",
				},
				response: null,
			};
		},
	};
}

export function normalizeConfiguredAccessTeamDomain(teamDomain: string | undefined): string | null {
	const trimmed = teamDomain?.trim();
	if (!trimmed) {
		return null;
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "https:" && !isLoopbackAccessIssuer(parsed)) {
			return null;
		}
		parsed.pathname = "";
		parsed.search = "";
		parsed.hash = "";
		const normalized = parsed.toString().replace(/\/$/u, "");
		return normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN ? null : normalized;
	} catch {
		return null;
	}
}

export function normalizeConfiguredAccessPolicyAud(audience: string | undefined): string | null {
	const trimmed = audience?.trim();
	return trimmed && trimmed !== PLACEHOLDER_ACCESS_POLICY_AUD ? trimmed : null;
}

export function getMissingAccessConfig(env: OpsAdmissionEnv): string[] {
	const missing: string[] = [];
	if (!normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN)) {
		missing.push("ACCESS_TEAM_DOMAIN");
	}
	if (!normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD)) {
		missing.push("ACCESS_POLICY_AUD");
	}
	return missing;
}

export async function validateCloudflareAccessRequest(
	request: Request,
	env: OpsAdmissionEnv,
): Promise<OpsAdmissionResult> {
	const missing = getMissingAccessConfig(env);
	if (missing.length > 0) {
		return {
			operator: null,
			response: jsonError("OPS_ADMISSION_NOT_CONFIGURED", "访问控制未配置。", 503, {
				missing,
			}),
		};
	}
	const token = resolveAccessAssertion(request);
	if (!token) {
		return {
			operator: null,
			response: jsonError("OPS_ACCESS_JWT_MISSING", "缺少 Cloudflare Access 登录凭据。", 401),
		};
	}
	const issuer = normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
	const audience = normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD);
	if (!(issuer && audience)) {
		throw new Error("validated Cloudflare Access configuration became unavailable");
	}
	try {
		const { payload } = await jwtVerify(token, getRemoteJwks(issuer), { audience, issuer });
		const operator = mapHumanOperatorContext(payload);
		return operator
			? { operator, response: null }
			: {
					operator: null,
					response: jsonError("OPS_ACCESS_JWT_INVALID", "Cloudflare Access 登录凭据无效。", 401),
				};
	} catch {
		return {
			operator: null,
			response: jsonError("OPS_ACCESS_JWT_INVALID", "Cloudflare Access 登录凭据无效。", 401),
		};
	}
}

function resolveAccessAssertion(request: Request): string | null {
	const headerToken = request.headers.get("cf-access-jwt-assertion")?.trim();
	return headerToken || readCookieValue(request.headers.get("cookie"), "CF_Authorization");
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) {
		return null;
	}
	for (const segment of cookieHeader.split(";")) {
		const separatorIndex = segment.indexOf("=");
		if (separatorIndex !== -1 && segment.slice(0, separatorIndex).trim() === name) {
			return segment.slice(separatorIndex + 1).trim() || null;
		}
	}
	return null;
}

function mapHumanOperatorContext(payload: JWTPayload): OpsOperatorContext | null {
	const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
	if (payload.type !== "app" || !subject) {
		return null;
	}
	const email = typeof payload.email === "string" ? payload.email.trim() : "";
	return {
		displayName: normalizeNullableString(payload.name),
		email: email || null,
		operatorId: email || subject,
		subject,
	};
}

function getRemoteJwks(issuer: string) {
	const cached = jwksByIssuer.get(issuer);
	if (cached) {
		return cached;
	}
	const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
	jwksByIssuer.set(issuer, jwks);
	return jwks;
}

function jsonError(code: string, message: string, status: 401 | 503, details?: unknown) {
	return new Response(
		JSON.stringify({ error: { code, ...(details ? { details } : {}), message } }),
		{
			headers: { "content-type": "application/json; charset=utf-8" },
			status,
		},
	);
}

function normalizeNullableString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isLoopbackAccessIssuer(parsed: URL) {
	return (
		parsed.protocol === "http:" &&
		(parsed.hostname === "127.0.0.1" ||
			parsed.hostname === "localhost" ||
			parsed.hostname === "::1")
	);
}

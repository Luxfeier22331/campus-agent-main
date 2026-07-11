import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

const CLOUDFLARE_ACCESS_ENVELOPE = "cloudflare-access";
const PLACEHOLDER_ACCESS_POLICY_AUD = "ops-web-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const SERVICE_TOKEN_COMMON_NAME_SUFFIX = ".access";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface OpsAdmissionEnv {
	ACCESS_POLICY_AUD?: string;
	ACCESS_TEAM_DOMAIN?: string;
	OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST?: string;
	OPS_WEB_ACCESS_HUMAN_OPERATOR_GROUP_ALLOWLIST?: string;
	OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST?: string;
	OPS_WEB_PROTECTION_ENVELOPE?: string;
	OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST?: string;
	OPS_WEB_RAW_HUMAN_OPERATOR_GROUP_ALLOWLIST?: string;
	OPS_WEB_RAW_SERVICE_TOKEN_OPERATOR_ALLOWLIST?: string;
}

export interface OpsOperatorContext {
	displayName: string | null;
	email: string | null;
	groups: string[];
	operatorId: string;
	principalClass: "human" | "service";
	serviceId: string | null;
	subject: string;
}

export interface OpsAdmission {
	admit(request: Request): Promise<OpsAdmissionResult>;
}

export type OpsAdmissionResult =
	| {
			operator: OpsOperatorContext;
			response: null;
	  }
	| {
			operator: null;
			response: Response;
	  };

export function createCloudflareAccessOpsAdmission(
	env: OpsAdmissionEnv = process.env,
): OpsAdmission {
	return {
		async admit(request) {
			return validateCloudflareAccessRequest(request, env);
		},
	};
}

export function createAllowAllOpsAdmission(operator?: Partial<OpsOperatorContext>): OpsAdmission {
	return {
		async admit() {
			return {
				operator: {
					displayName: operator?.displayName ?? "Fixture Operator",
					email: operator?.email ?? "ops@example.test",
					groups: operator?.groups ?? [],
					operatorId: operator?.operatorId ?? "ops@example.test",
					principalClass: operator?.principalClass ?? "human",
					serviceId: operator?.serviceId ?? null,
					subject: operator?.subject ?? "fixture-operator",
				},
				response: null,
			};
		},
	};
}

export function operatorCanReadRawObservability(
	operator: OpsOperatorContext,
	env: OpsAdmissionEnv = process.env,
): boolean {
	if (operator.principalClass === "service") {
		return Boolean(
			operator.serviceId &&
				normalizeCsvSet(env.OPS_WEB_RAW_SERVICE_TOKEN_OPERATOR_ALLOWLIST).has(operator.serviceId),
		);
	}
	return humanOperatorAllowed(
		{ email: operator.email ?? "", groups: operator.groups },
		{
			OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST: env.OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST,
			OPS_WEB_ACCESS_HUMAN_OPERATOR_GROUP_ALLOWLIST: env.OPS_WEB_RAW_HUMAN_OPERATOR_GROUP_ALLOWLIST,
		},
	);
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
	if (env.OPS_WEB_PROTECTION_ENVELOPE !== CLOUDFLARE_ACCESS_ENVELOPE) {
		missing.push("OPS_WEB_PROTECTION_ENVELOPE=cloudflare-access");
	}
	if (!normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN)) {
		missing.push("ACCESS_TEAM_DOMAIN");
	}
	if (!normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD)) {
		missing.push("ACCESS_POLICY_AUD");
	}
	if (!hasOperatorAllowlist(env)) {
		missing.push(
			"one of OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST, OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
		);
	}
	return missing;
}

export async function validateCloudflareAccessRequest(
	request: Request,
	env: OpsAdmissionEnv,
): Promise<OpsAdmissionResult> {
	const missingAccessConfig = getMissingAccessConfig(env);
	if (missingAccessConfig.length > 0) {
		return {
			operator: null,
			response: jsonError("OPS_ADMISSION_NOT_CONFIGURED", "访问控制未配置。", 503, {
				missing: missingAccessConfig,
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
		return {
			operator: null,
			response: jsonError("OPS_ADMISSION_NOT_CONFIGURED", "访问控制未配置。", 503, {
				missing: getMissingAccessConfig(env),
			}),
		};
	}

	try {
		const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
			audience,
			issuer,
		});
		const operator =
			mapServiceTokenOperatorContext(payload, env) ?? mapHumanOperatorContext(payload, env);
		if (!operator) {
			return {
				operator: null,
				response: jsonError("OPS_ACCESS_JWT_INVALID", "Cloudflare Access 登录凭据无效。", 401),
			};
		}
		return {
			operator,
			response: null,
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
	if (headerToken) {
		return headerToken;
	}
	return readCookieValue(request.headers.get("cookie"), "CF_Authorization");
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) {
		return null;
	}
	for (const segment of cookieHeader.split(";")) {
		const separatorIndex = segment.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}
		if (segment.slice(0, separatorIndex).trim() !== name) {
			continue;
		}
		return segment.slice(separatorIndex + 1).trim() || null;
	}
	return null;
}

function mapHumanOperatorContext(
	payload: JWTPayload,
	env: OpsAdmissionEnv,
): OpsOperatorContext | null {
	const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
	const email = typeof payload.email === "string" ? payload.email.trim() : "";
	if (!(email || subject)) {
		return null;
	}
	const groups = normalizePayloadGroups(readCustomAccessClaim(payload, "groups"));
	if (!humanOperatorAllowed({ email, groups }, env)) {
		return null;
	}

	return {
		displayName: normalizeNullableString(payload.name),
		email: email || null,
		groups,
		operatorId: email || subject,
		principalClass: "human",
		serviceId: null,
		subject,
	};
}

function mapServiceTokenOperatorContext(
	payload: JWTPayload,
	env: OpsAdmissionEnv,
): OpsOperatorContext | null {
	if (payload.type !== "app" || payload.sub !== "") {
		return null;
	}
	const serviceId = normalizeAccessServiceTokenCommonName(payload.common_name);
	if (!(serviceId && normalizeServiceTokenAllowlist(env).has(serviceId))) {
		return null;
	}

	return {
		displayName: serviceId,
		email: null,
		groups: [],
		operatorId: serviceId,
		principalClass: "service",
		serviceId,
		subject: serviceId,
	};
}

function normalizeAccessServiceTokenCommonName(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed.endsWith(SERVICE_TOKEN_COMMON_NAME_SUFFIX)) {
		return null;
	}
	return trimmed.slice(0, -SERVICE_TOKEN_COMMON_NAME_SUFFIX.length).trim() || null;
}

function normalizeServiceTokenAllowlist(env: OpsAdmissionEnv): Set<string> {
	return normalizeCsvSet(env.OPS_WEB_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST);
}

function humanOperatorAllowed(
	operator: { email: string; groups: string[] },
	env: OpsAdmissionEnv,
): boolean {
	const emailAllowlist = normalizeCsvSet(env.OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST, {
		lowercase: true,
	});
	const groupAllowlist = normalizeCsvSet(env.OPS_WEB_ACCESS_HUMAN_OPERATOR_GROUP_ALLOWLIST);
	const normalizedEmail = operator.email.toLowerCase();
	return (
		(Boolean(normalizedEmail) && emailAllowlist.has(normalizedEmail)) ||
		operator.groups.some((group) => groupAllowlist.has(group))
	);
}

function hasOperatorAllowlist(env: OpsAdmissionEnv): boolean {
	return (
		normalizeCsvSet(env.OPS_WEB_ACCESS_HUMAN_OPERATOR_EMAIL_ALLOWLIST).size > 0 ||
		normalizeServiceTokenAllowlist(env).size > 0
	);
}

function readCustomAccessClaim(payload: JWTPayload, key: string): unknown {
	const custom = payload.custom;
	return custom && typeof custom === "object" && !Array.isArray(custom)
		? (custom as Record<string, unknown>)[key]
		: undefined;
}

function normalizePayloadGroups(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
				.map((item) => item.trim())
		: [];
}

function normalizeCsvSet(
	value: string | undefined,
	options?: { lowercase?: boolean },
): Set<string> {
	return new Set(
		(value ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean)
			.map((item) => (options?.lowercase ? item.toLowerCase() : item)),
	);
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

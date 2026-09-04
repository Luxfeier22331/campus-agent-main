import { resolveSafeAuthNavigationTarget } from "./return-target";

export interface CampusOAuthClientContext {
	clientId: string;
	displayName: string;
	hostLabel: string;
}

export interface CampusOAuthContext {
	clientId: string;
	oauthQuery: string | null;
	requestedScopes: readonly string[];
	scopeItems: readonly string[];
	isOAuthRequest: true;
}

const SCOPE_LABELS: Readonly<Record<string, string>> = {
	email: "邮箱地址",
	openid: "登录身份",
	profile: "基本资料",
};

export function resolveCampusOAuthContext(
	search: string | URLSearchParams,
): CampusOAuthContext | null {
	const params = typeof search === "string" ? new URLSearchParams(search) : search;
	const oauthQuery = buildSignedCampusOAuthQuery(params);
	const requestParams = oauthQuery ? new URLSearchParams(oauthQuery) : params;
	const clientId = requestParams.get("client_id")?.trim();
	if (!clientId) {
		return null;
	}

	return {
		clientId,
		oauthQuery,
		requestedScopes: normalizeScopes(requestParams.get("scope")),
		scopeItems: normalizeScopes(requestParams.get("scope")).map(
			(scope) => SCOPE_LABELS[scope] ?? scope,
		),
		isOAuthRequest: true,
	};
}

export function buildSignedCampusOAuthQuery(params: URLSearchParams): string | null {
	if (params.getAll("sig").length !== 1) {
		return null;
	}
	const signedParameterNames = new Set(params.getAll("ba_param"));
	if (signedParameterNames.size === 0) {
		return null;
	}

	const signed = new URLSearchParams();
	for (const [key, value] of params.entries()) {
		if (key === "sig" || key === "ba_param" || signedParameterNames.has(key)) {
			signed.append(key, value);
		}
	}
	return signed.toString();
}

export function buildFallbackCampusOAuthClient(clientId: string): CampusOAuthClientContext {
	return {
		clientId,
		displayName: "外部应用",
		hostLabel: `client_id: ${clientId}`,
	};
}

export function parseCampusOAuthClient(
	payload: unknown,
	requestedClientId: string,
): CampusOAuthClientContext | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const client = payload as Record<string, unknown>;
	const clientId = typeof client.client_id === "string" ? client.client_id.trim() : "";
	if (!clientId || clientId !== requestedClientId) {
		return null;
	}

	const name = typeof client.client_name === "string" ? client.client_name.trim() : "";
	const uri = typeof client.client_uri === "string" ? client.client_uri.trim() : "";
	return {
		clientId,
		displayName: name || "外部应用",
		hostLabel: name ? (safeHostLabel(uri) ?? `client_id: ${clientId}`) : `client_id: ${clientId}`,
	};
}

export function resolveSafeOAuthRedirectTarget(
	value: unknown,
	currentOrigin: string,
): string | null {
	return resolveSafeAuthNavigationTarget(value, currentOrigin);
}

function normalizeScopes(value: string | null): string[] {
	return [
		...new Set(
			(value ?? "")
				.split(/\s+/u)
				.map((scope) => scope.trim())
				.filter(Boolean),
		),
	];
}

function safeHostLabel(value: string): string | null {
	try {
		const url = new URL(value);
		if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
			return null;
		}
		return url.host;
	} catch {
		return null;
	}
}

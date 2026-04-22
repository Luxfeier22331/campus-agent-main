import type { createRemoteJWKSet } from "jose";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	PANEL_APP_NAME?: string;
	PANEL_APP_API_SHARED_SECRET?: string;
	PANEL_RUNTIME_API_BASE_URL?: string;
	PANEL_PROTECTION_ENVELOPE?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_POLICY_AUD?: string;
}

export interface OperatorContext {
	operator_id: string;
	principal_class: "human";
	subject: string;
	display_name: string | null;
	email: string | null;
	groups: string[];
}

export const JSON_HEADERS = {
	"cache-control": "no-store",
	"content-type": "application/json; charset=utf-8",
} as const;

export const CLOUDFLARE_ACCESS_ENVELOPE = "cloudflare-access";
export const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
export const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";
export const REQUIRED_PROTECTION_ENVELOPE = "PANEL_PROTECTION_ENVELOPE=cloudflare-access";
export const JWKS_BY_ISSUER = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const FORWARDED_HEADERS = ["accept", "content-type", "x-trace-id"] as const;

export function resolvePanelAppName(env: Env): string {
	return env.PANEL_APP_NAME || "campus-agent-protected-panel";
}

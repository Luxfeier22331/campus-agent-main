import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parse as parseDomain } from "tldts";

const adapterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(adapterRoot, "../../../..");
const DEFAULT_PORTAL_BASE_URL = "https://portal.example.edu";

export interface InternalPortalConfig {
	authSsoCookieDomain: string | null;
	authSsoTgc: string | null;
	authSsoTgcFile: string | null;
	portalBaseUrl: string;
	portalPageUrl: string;
	sourceHomeUrl: string;
	siteId: string;
	portalProxyServer: string | null;
}

export function loadInternalPortalEnv(processEnv: NodeJS.ProcessEnv = process.env): void {
	dotenv.config({ path: path.join(adapterRoot, ".env.local"), processEnv, quiet: true });
	dotenv.config({ path: path.join(adapterRoot, ".env"), processEnv, quiet: true });
	dotenv.config({ path: path.join(repoRoot, ".env"), processEnv, quiet: true });
}

export function resolveInternalPortalConfig(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): InternalPortalConfig {
	const portalBaseUrl = resolveHttpsUrl(
		String(source.INTERNAL_PORTAL_BASE_URL || DEFAULT_PORTAL_BASE_URL).trim(),
		"INTERNAL_PORTAL_BASE_URL",
	);
	const portalPageUrl = resolvePortalPageUrl(
		String(
			source.INTERNAL_PORTAL_PAGE_URL || new URL("/page/11#/", portalBaseUrl).toString(),
		).trim(),
		portalBaseUrl,
	);
	const authSsoTgc = normalizeOptionalSecret(source.INTERNAL_PORTAL_SSO_TGC);
	const authSsoTgcFile = resolveOptionalPath(source.INTERNAL_PORTAL_SSO_TGC_FILE);
	if (authSsoTgc && authSsoTgcFile) {
		throw new Error(
			"INTERNAL_PORTAL_SSO_TGC and INTERNAL_PORTAL_SSO_TGC_FILE are mutually exclusive",
		);
	}
	return {
		authSsoCookieDomain: resolveSsoCookieDomain({
			portalBaseUrl,
			rawDomain: source.INTERNAL_PORTAL_SSO_COOKIE_DOMAIN,
		}),
		authSsoTgc,
		authSsoTgcFile,
		portalBaseUrl,
		portalPageUrl,
		sourceHomeUrl: resolveHttpsUrl(
			String(source.INTERNAL_PORTAL_SOURCE_HOME_URL || portalBaseUrl).trim(),
			"INTERNAL_PORTAL_SOURCE_HOME_URL",
		),
		siteId: resolveInternalPortalSiteId(source),
		portalProxyServer: normalizeOptionalSecret(source.INTERNAL_PORTAL_PROXY_SERVER),
	};
}

export function resolveInternalPortalSiteId(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
	return (
		String(source.INTERNAL_PORTAL_SITE_ID || "synthetic_internal_portal").trim() ||
		"synthetic_internal_portal"
	);
}

function resolveOptionalPath(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? path.resolve(normalized) : null;
}

function resolveHttpsUrl(raw: string, key: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`${key} must be an absolute HTTPS URL`);
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
		throw new Error(`${key} must be a credential-free HTTPS URL`);
	}
	return parsed.toString() === `${parsed.origin}/` ? parsed.origin : parsed.toString();
}

function resolvePortalPageUrl(raw: string, portalBaseUrl: string): string {
	const normalized = resolveHttpsUrl(raw, "INTERNAL_PORTAL_PAGE_URL");
	if (new URL(normalized).hostname !== new URL(portalBaseUrl).hostname) {
		throw new Error("INTERNAL_PORTAL_PAGE_URL must use the portal host");
	}
	return normalized;
}

function normalizeOptionalSecret(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? normalized : null;
}

function resolveSsoCookieDomain(input: {
	portalBaseUrl: string;
	rawDomain: string | undefined;
}): string | null {
	const normalized = normalizeOptionalSecret(input.rawDomain);
	if (!normalized) {
		return null;
	}
	const portalHost = new URL(input.portalBaseUrl).hostname.toLowerCase();
	const cookieHost = normalized.replace(/^\./, "").toLowerCase();
	const parsed = parseDomain(cookieHost);
	if (!parsed.domain || parsed.domain !== cookieHost) {
		throw new Error("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must be a registrable parent domain");
	}
	if (!(portalHost === cookieHost || portalHost.endsWith(`.${cookieHost}`))) {
		throw new Error("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must match or parent the portal host");
	}
	return normalized.startsWith(".") ? `.${cookieHost}` : cookieHost;
}

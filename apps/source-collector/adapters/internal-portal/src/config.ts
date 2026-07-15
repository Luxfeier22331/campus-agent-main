import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parse as parseDomain } from "tldts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../../../..");
const REQUIRED_NO_PROXY_HOSTS = [
	"example.edu",
	".example.edu",
	"portal.example.edu",
	"auth.example.edu",
];
const RETIRED_INTERNAL_PORTAL_ENV_PREFIX = "AUTHENTICATED_NOTICE_";

export interface InternalPortalConfig {
	runtimeDir: string;
	defaultInlineVisualCapture: boolean;
	authStorageStatePath: string;
	authJsessionId: string | null;
	authNginxCookie: string | null;
	authSsoCookieDomain: string | null;
	authSsoTgcToken: string | null;
	historicalBackfillMaxPagesPerType: number | null;
	noticeTypesPath: string;
	portalBaseUrl: string;
	portalPageUrl: string;
	sourceHomeUrl: string;
	siteId: string;
	requestMaxRetries: number;
	authCheckNoticeType: string;
	authCheckPageSize: number;
	bypassProxyForPortal: boolean;
	portalProxyServer: string | null;
}

export function loadInternalPortalEnv(): void {
	dotenv.config({ path: path.join(repoRoot, ".env") });
	dotenv.config({ path: path.join(packageRoot, ".env"), override: true });
	assertNoRetiredInternalPortalEnv(process.env);
	applyInternalPortalNoProxyEnv(process.env);
}

export function applyInternalPortalNoProxyEnv(target: NodeJS.ProcessEnv): void {
	assertNoRetiredInternalPortalEnv(target);
	const raw = target.NO_PROXY ?? target.no_proxy;
	const merged = shouldBypassProxyForPortal(target.INTERNAL_PORTAL_BYPASS_PROXY)
		? mergeNoProxyValue(raw)
		: removePortalNoProxyHosts(raw);
	target.NO_PROXY = merged;
	target.no_proxy = merged;
}

export function resolveInternalPortalConfig(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): InternalPortalConfig {
	assertNoRetiredInternalPortalEnv(source);
	const runtimeDir = path.resolve(
		String(source.INTERNAL_PORTAL_RUNTIME_DIR || path.join(packageRoot, "runtime")),
	);
	const portalBaseUrl = String(
		source.INTERNAL_PORTAL_BASE_URL || "https://portal.example.edu",
	).trim();
	const bypassProxyForPortal = shouldBypassProxyForPortal(source.INTERNAL_PORTAL_BYPASS_PROXY);
	const authSsoTgcToken = normalizeOptionalSecret(source.INTERNAL_PORTAL_SSO_TGC);
	return {
		runtimeDir,
		defaultInlineVisualCapture: parseBooleanFlag(
			source.INTERNAL_PORTAL_DEFAULT_INLINE_VISUAL_CAPTURE,
			false,
		),
		authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
		authJsessionId: normalizeOptionalSecret(source.INTERNAL_PORTAL_JSESSIONID),
		authNginxCookie: normalizeOptionalSecret(source.INTERNAL_PORTAL_NGINX),
		authSsoCookieDomain: resolveSsoCookieDomain({
			portalBaseUrl,
			rawDomain: source.INTERNAL_PORTAL_SSO_COOKIE_DOMAIN,
			ssoToken: authSsoTgcToken,
		}),
		authSsoTgcToken,
		historicalBackfillMaxPagesPerType: parseOptionalPositiveInteger(
			source.INTERNAL_PORTAL_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE,
		),
		noticeTypesPath: path.resolve(
			String(
				source.INTERNAL_PORTAL_NOTICE_TYPES_PATH ||
					path.join(packageRoot, "config", "notice-types.json"),
			),
		),
		portalBaseUrl,
		portalPageUrl: String(
			source.INTERNAL_PORTAL_PAGE_URL || "https://portal.example.edu/page/11#/",
		).trim(),
		sourceHomeUrl: String(source.INTERNAL_PORTAL_SOURCE_HOME_URL || portalBaseUrl).trim(),
		siteId:
			String(source.INTERNAL_PORTAL_SITE_ID || "synthetic_internal_portal").trim() ||
			"synthetic_internal_portal",
		requestMaxRetries: parsePositiveInteger(source.INTERNAL_PORTAL_REQUEST_MAX_RETRIES, 3),
		authCheckNoticeType: String(source.INTERNAL_PORTAL_AUTH_CHECK_NOTICE_TYPE || "5").trim() || "5",
		authCheckPageSize: parsePositiveInteger(source.INTERNAL_PORTAL_AUTH_CHECK_PAGE_SIZE, 3),
		bypassProxyForPortal,
		portalProxyServer: resolvePortalProxyServer(source, bypassProxyForPortal),
	};
}

function normalizeOptionalSecret(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? normalized : null;
}

export function ensureRuntimeDirs(config: InternalPortalConfig): void {
	fs.mkdirSync(path.join(config.runtimeDir, "auth"), { recursive: true });
}

function parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultValue;
	}
	return Math.floor(parsed);
}

function parseOptionalPositiveInteger(raw: string | undefined): number | null {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return Math.floor(parsed);
}

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
	const normalized = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return defaultValue;
	}
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	return defaultValue;
}

function mergeNoProxyValue(raw: string | undefined): string {
	const tokens = (raw || "")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	const seen = new Set(tokens.map((token) => token.toLowerCase()));
	for (const host of REQUIRED_NO_PROXY_HOSTS) {
		const normalized = host.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		tokens.push(host);
		seen.add(normalized);
	}
	return tokens.join(",");
}

function removePortalNoProxyHosts(raw: string | undefined): string {
	const portalHosts = new Set(REQUIRED_NO_PROXY_HOSTS.map((host) => host.toLowerCase()));
	return (raw || "")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean)
		.filter((token) => !portalHosts.has(token.toLowerCase()))
		.join(",");
}

function shouldBypassProxyForPortal(raw: string | undefined): boolean {
	const normalized = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return true;
	}
	return !["0", "false", "no", "off"].includes(normalized);
}

function resolvePortalProxyServer(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
	bypassProxyForPortal: boolean,
): string | null {
	if (bypassProxyForPortal) {
		return null;
	}
	const normalized = String(source.INTERNAL_PORTAL_PROXY_SERVER ?? "").trim();
	if (!normalized) {
		throw new Error(
			"INTERNAL_PORTAL_PROXY_SERVER is required when INTERNAL_PORTAL_BYPASS_PROXY=false",
		);
	}
	return normalized;
}

function resolveSsoCookieDomain(input: {
	portalBaseUrl: string;
	rawDomain: string | undefined;
	ssoToken: string | null;
}): string | null {
	const normalized = normalizeOptionalSecret(input.rawDomain);
	if (!normalized) {
		if (!input.ssoToken) {
			return null;
		}
		throw new Error(
			"INTERNAL_PORTAL_SSO_COOKIE_DOMAIN is required when INTERNAL_PORTAL_SSO_TGC is set",
		);
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

function assertNoRetiredInternalPortalEnv(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
	const retiredKeys = Object.keys(source)
		.filter((key) => key.startsWith(RETIRED_INTERNAL_PORTAL_ENV_PREFIX))
		.sort();
	if (retiredKeys.length === 0) {
		return;
	}
	throw new Error(`retired internal-portal env keys are not supported: ${retiredKeys.join(", ")}`);
}

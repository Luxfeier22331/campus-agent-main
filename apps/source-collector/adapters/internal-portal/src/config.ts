import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parse as parseDomain } from "tldts";

const adapterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const INTERNAL_PORTAL_DESCRIPTOR_PATH = fileURLToPath(
	new URL("../../../../../configs/sources/internal-portal.json", import.meta.url),
);

export interface InternalPortalDescriptor {
	portalBaseUrl: string;
	portalPageUrl: string;
	siteId: string;
	sourceHomeUrl: string;
	ssoCookieDomain: string;
}

export interface InternalPortalConfig {
	authSsoCookieDomain: string | null;
	authSsoTgc: string | null;
	portalBaseUrl: string;
	portalPageUrl: string;
	sourceHomeUrl: string;
	siteId: string;
	portalProxyServer: string | null;
}

export function loadInternalPortalEnv(processEnv: NodeJS.ProcessEnv = process.env): void {
	dotenv.config({ path: path.join(adapterRoot, ".env.local"), processEnv, quiet: true });
	dotenv.config({ path: path.join(adapterRoot, ".env"), processEnv, quiet: true });
}

export function resolveInternalPortalConfig(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
	descriptor: InternalPortalDescriptor = loadInternalPortalDescriptor(),
): InternalPortalConfig {
	const portalBaseUrl = resolveHttpsUrl(descriptor.portalBaseUrl, "portal_base_url");
	const portalPageUrl = resolvePortalPageUrl(descriptor.portalPageUrl, portalBaseUrl);
	const authSsoTgc = normalizeOptionalSecret(source.INTERNAL_PORTAL_SSO_TGC);
	return {
		authSsoCookieDomain: resolveSsoCookieDomain({
			portalBaseUrl,
			rawDomain: descriptor.ssoCookieDomain,
		}),
		authSsoTgc,
		portalBaseUrl,
		portalPageUrl,
		sourceHomeUrl: resolveHttpsUrl(descriptor.sourceHomeUrl, "source_home_url"),
		siteId: resolveInternalPortalSiteId(descriptor),
		portalProxyServer: normalizeOptionalSecret(source.INTERNAL_PORTAL_PROXY_SERVER),
	};
}

export function loadInternalPortalDescriptor(
	path = INTERNAL_PORTAL_DESCRIPTOR_PATH,
): InternalPortalDescriptor {
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("internal portal descriptor must be a JSON object");
	}
	const source = payload as Record<string, unknown>;
	return {
		portalBaseUrl: requiredDescriptorString(source, "portal_base_url"),
		portalPageUrl: requiredDescriptorString(source, "portal_page_url"),
		siteId: requiredDescriptorString(source, "site_id"),
		sourceHomeUrl: requiredDescriptorString(source, "source_home_url"),
		ssoCookieDomain: requiredDescriptorString(source, "sso_cookie_domain"),
	};
}

export function resolveInternalPortalSiteId(descriptor: InternalPortalDescriptor): string {
	return descriptor.siteId.trim();
}

function requiredDescriptorString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${key} is required in the internal portal descriptor`);
	}
	return value.trim();
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
	const normalized = resolveHttpsUrl(raw, "portal_page_url");
	if (new URL(normalized).hostname !== new URL(portalBaseUrl).hostname) {
		throw new Error("portal_page_url must use the portal host");
	}
	return normalized;
}

function normalizeOptionalSecret(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? normalized : null;
}

function resolveSsoCookieDomain(input: {
	portalBaseUrl: string;
	rawDomain: string;
}): string | null {
	const normalized = normalizeOptionalSecret(input.rawDomain);
	if (!normalized) {
		return null;
	}
	const portalHost = new URL(input.portalBaseUrl).hostname.toLowerCase();
	const cookieHost = normalized.replace(/^\./, "").toLowerCase();
	const parsed = parseDomain(cookieHost);
	if (!parsed.domain || parsed.domain !== cookieHost) {
		throw new Error("sso_cookie_domain must be a registrable parent domain");
	}
	if (!(portalHost === cookieHost || portalHost.endsWith(`.${cookieHost}`))) {
		throw new Error("sso_cookie_domain must match or parent the portal host");
	}
	return normalized.startsWith(".") ? `.${cookieHost}` : cookieHost;
}

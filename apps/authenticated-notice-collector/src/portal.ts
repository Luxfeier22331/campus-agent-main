import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, request } from "playwright";

import { type AuthPortalStorageState, bootstrapPortalStorageState } from "./auth-crawlee-runner.js";
import { type CollectorConfig, ensureRuntimeDirs, resolveCollectorConfig } from "./config.js";
import type { ApiRequestContextLike, DisposableApiContextLike } from "./types.js";

type PortalStorageState = AuthPortalStorageState;
const PORTAL_BOOTSTRAP_TIMEOUT_MS = 12_000;
const SSO_TGC_COOKIE_NAME = "SSO_TGC";

export interface CreateApiContextFromStorageStateDependencies {
	bootstrapStorageState?: (input: {
		config: CollectorConfig;
		timeoutMs: number;
	}) => Promise<PortalStorageState>;
	createRequestContext?: (input: {
		baseURL: string;
		extraHTTPHeaders: Record<string, string>;
		proxy?: { server: string };
		storageState: PortalStorageState;
	}) => Promise<ApiRequestContextLike & DisposableApiContextLike>;
}

export async function createApiContextFromStorageState(
	config: CollectorConfig = resolveCollectorConfig(process.env),
	dependencies: CreateApiContextFromStorageStateDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
	ensureRuntimeDirs(config);
	seedStoredAuthFromConfig(config);
	const storageState = await (dependencies.bootstrapStorageState ?? defaultBootstrapStorageState)({
		config,
		timeoutMs: PORTAL_BOOTSTRAP_TIMEOUT_MS,
	});
	const mergedStorageState = mergeSeededCookies(storageState, resolveSeedCookies(config), {
		preferSeeded: false,
	});
	writeStoredAuthStorageState(config.authStorageStatePath, mergedStorageState);
	return await (dependencies.createRequestContext ?? defaultCreateRequestContext)({
		baseURL: config.portalBaseUrl,
		extraHTTPHeaders: buildPortalApiHeaders(config),
		...buildProxyOption(config),
		storageState: mergedStorageState,
	});
}

function defaultCreateRequestContext(input: {
	baseURL: string;
	extraHTTPHeaders: Record<string, string>;
	storageState: PortalStorageState;
}): Promise<APIRequestContext> {
	return request.newContext(input);
}

function defaultBootstrapStorageState(input: {
	config: CollectorConfig;
	timeoutMs: number;
}): Promise<PortalStorageState> {
	return bootstrapPortalStorageState(input);
}

function readStoredAuthStorageState(storageStatePath: string): PortalStorageState {
	const raw = fs.readFileSync(storageStatePath, "utf-8");
	const parsed = JSON.parse(raw) as PortalStorageState;
	if (!(Array.isArray(parsed.cookies) && Array.isArray(parsed.origins))) {
		throw new Error(`invalid storage state: ${storageStatePath}`);
	}
	return parsed;
}

function writeStoredAuthStorageState(
	storageStatePath: string,
	storageState: PortalStorageState,
): void {
	fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
	fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2), "utf-8");
}

function seedStoredAuthFromConfig(config: CollectorConfig): void {
	const seededCookies = resolveSeedCookies(config);
	if (seededCookies.length === 0) {
		return;
	}

	let storageState: PortalStorageState = { cookies: [], origins: [] };
	if (fs.existsSync(config.authStorageStatePath)) {
		storageState = readStoredAuthStorageState(config.authStorageStatePath);
	}

	storageState = mergeSeededCookies(storageState, seededCookies, {
		preferSeeded: true,
	});
	writeStoredAuthStorageState(config.authStorageStatePath, storageState);
}

function resolveSeedCookies(config: CollectorConfig): PortalStorageState["cookies"][number][] {
	const portalHost = new URL(config.portalBaseUrl).hostname;
	const seededCookies: PortalStorageState["cookies"][number][] = [];
	const sessionToken = validateCookieToken(
		config.authJsessionId,
		"AUTHENTICATED_NOTICE_JSESSIONID",
	);
	if (sessionToken) {
		seededCookies.push(buildPortalCookie(portalHost, "JSESSIONID", sessionToken));
	}
	const nginxToken = validateCookieToken(config.authNginxCookie, "AUTHENTICATED_NOTICE_NGINX");
	if (nginxToken) {
		seededCookies.push(buildPortalCookie(portalHost, "nginx", nginxToken));
	}
	const ssoToken = extractSsoTgcToken(config.authSsoTgcToken);
	if (ssoToken) {
		seededCookies.push(
			buildPortalCookie(resolveParentCookieDomain(portalHost), SSO_TGC_COOKIE_NAME, ssoToken),
		);
	}
	return seededCookies;
}

function resolveParentCookieDomain(hostname: string): string {
	const parts = hostname.split(".").filter(Boolean);
	if (parts.length < 2 || hostname === "localhost") {
		return hostname;
	}
	return `.${parts.slice(-2).join(".")}`;
}

function buildPortalCookie(
	domain: string,
	name: string,
	value: string,
): PortalStorageState["cookies"][number] {
	return {
		domain,
		expires: -1,
		httpOnly: true,
		name,
		path: "/",
		sameSite: "Lax",
		secure: true,
		value,
	};
}

function mergeSeededCookies(
	storageState: PortalStorageState,
	seededCookies: PortalStorageState["cookies"][number][],
	options: { preferSeeded: boolean },
): PortalStorageState {
	if (seededCookies.length === 0) {
		return storageState;
	}
	const seededKeys = new Set(seededCookies.map(buildCookieIdentityKey));
	const existingKeys = new Set(storageState.cookies.map(buildCookieIdentityKey));
	return {
		cookies: options.preferSeeded
			? [
					...seededCookies,
					...storageState.cookies.filter(
						(cookie) => !seededKeys.has(buildCookieIdentityKey(cookie)),
					),
				]
			: [
					...storageState.cookies,
					...seededCookies.filter((cookie) => !existingKeys.has(buildCookieIdentityKey(cookie))),
				],
		origins: storageState.origins,
	};
}

function buildCookieIdentityKey(cookie: PortalStorageState["cookies"][number]): string {
	return [
		cookie.name.trim().toLowerCase(),
		cookie.domain.trim().toLowerCase(),
		(cookie.path || "/").trim(),
	].join("\u0000");
}

function extractSsoTgcToken(raw: string | null): string | null {
	const normalized = raw?.trim();
	if (!normalized) {
		return null;
	}

	for (const part of normalized.split(";")) {
		const candidate = part.trim();
		if (!candidate.toLowerCase().startsWith(`${SSO_TGC_COOKIE_NAME.toLowerCase()}=`)) {
			continue;
		}
		const value = candidate.slice(SSO_TGC_COOKIE_NAME.length + 1).trim();
		return validateSsoTgcToken(value);
	}

	return validateSsoTgcToken(normalized);
}

function validateCookieToken(value: string | null, envName: string): string | null {
	const normalized = value?.trim() ?? "";
	if (!normalized) {
		return null;
	}
	for (let index = 0; index < normalized.length; index += 1) {
		const code = normalized.charCodeAt(index);
		if (
			code < 0x21 ||
			code > 0x7e ||
			code === 0x22 ||
			code === 0x2c ||
			code === 0x3b ||
			code === 0x5c
		) {
			throw new Error(`invalid ${envName}: expected a raw cookie value`);
		}
	}
	return normalized;
}

function validateSsoTgcToken(value: string): string | null {
	if (!value) {
		return null;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (
			code < 0x21 ||
			code > 0x7e ||
			code === 0x22 ||
			code === 0x2c ||
			code === 0x3b ||
			code === 0x5c
		) {
			throw new Error(
				"invalid AUTHENTICATED_NOTICE_SSO_TGC: expected a raw cookie value or SSO_TGC cookie fragment",
			);
		}
	}
	return value;
}

function buildPortalApiHeaders(config: CollectorConfig): Record<string, string> {
	return {
		"x-requested-with": "XMLHttpRequest",
		accept: "application/json, text/plain, */*",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		referer: config.portalPageUrl.replace(/#.*$/, ""),
	};
}

function buildProxyOption(config: CollectorConfig): { proxy?: { server: string } } {
	return config.portalProxyServer ? { proxy: { server: config.portalProxyServer } } : {};
}

import fs from "node:fs";
import path from "node:path";

import {
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	chromium,
	request,
} from "playwright";

import { type CollectorConfig, ensureRuntimeDirs, resolveCollectorConfig } from "./config";
import type { ApiRequestContextLike, DisposableApiContextLike } from "./types";

type PortalStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const PORTAL_BOOTSTRAP_TIMEOUT_MS = 12_000;
const SSO_TGC_COOKIE_NAME = "SSO_TGC";

export interface BrowserLike {
	close(): Promise<void>;
	newContext(input: { storageState: string | PortalStorageState }): Promise<BrowserContextLike>;
}

export interface BrowserContextLike {
	newPage(): Promise<PageLike>;
	storageState(input?: { path?: string }): Promise<PortalStorageState>;
}

export interface PageLike {
	close?(): Promise<void>;
	goto(url: string, input: { timeout?: number; waitUntil: "domcontentloaded" }): Promise<unknown>;
}

export interface CreateApiContextFromStorageStateDependencies {
	launchBrowser?: (config: CollectorConfig) => Promise<BrowserLike>;
	createRequestContext?: (input: {
		baseURL: string;
		extraHTTPHeaders: Record<string, string>;
		proxy?: { server: string };
		storageState: PortalStorageState;
	}) => Promise<ApiRequestContextLike & DisposableApiContextLike>;
}

export async function launchContextWithStoredAuth(
	config: CollectorConfig = resolveCollectorConfig(process.env),
	launchBrowser: (config: CollectorConfig) => Promise<BrowserLike> = defaultLaunchBrowser,
): Promise<{ browserContext: BrowserContextLike; close: () => Promise<void> }> {
	ensureRuntimeDirs(config);
	const browser = await launchBrowser(config);
	const browserContext = await browser.newContext({
		storageState: config.authStorageStatePath,
	});
	return {
		browserContext,
		close: async () => {
			await browser.close();
		},
	};
}

export async function createApiContextFromStorageState(
	config: CollectorConfig = resolveCollectorConfig(process.env),
	dependencies: CreateApiContextFromStorageStateDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
	ensureRuntimeDirs(config);
	seedStoredAuthFromConfig(config);
	let launchedContext: Awaited<ReturnType<typeof launchContextWithStoredAuth>> | null = null;
	try {
		launchedContext = await launchContextWithStoredAuth(config, dependencies.launchBrowser);
	} catch (error) {
		if (!isRecoverablePortalBootstrapError(error)) {
			throw error;
		}
		return await (dependencies.createRequestContext ?? defaultCreateRequestContext)({
			baseURL: config.portalBaseUrl,
			extraHTTPHeaders: buildPortalApiHeaders(config),
			...buildProxyOption(config),
			storageState: readStoredAuthStorageState(config.authStorageStatePath),
		});
	}

	const { browserContext, close } = launchedContext;
	try {
		const page = await browserContext.newPage();
		try {
			// Visiting the portal once often refreshes the host-scoped session cookie
			// that the notice API expects. The portal route is also known to hang in
			// headless mode, so we fall back to the stored session when the refresh
			// attempt times out and let the subsequent API request prove validity.
			try {
				await page.goto(config.portalPageUrl, {
					timeout: PORTAL_BOOTSTRAP_TIMEOUT_MS,
					waitUntil: "domcontentloaded",
				});
			} catch (error) {
				if (!isRecoverablePortalBootstrapError(error)) {
					throw error;
				}
			}
			const storageState = await browserContext.storageState({
				path: config.authStorageStatePath,
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
		} finally {
			await page.close?.();
		}
	} finally {
		await close();
	}
}

function defaultLaunchBrowser(config: CollectorConfig): Promise<Browser> {
	return chromium.launch({
		headless: true,
		channel: "chrome",
		...buildProxyOption(config),
		timeout: PORTAL_BOOTSTRAP_TIMEOUT_MS,
	});
}

function defaultCreateRequestContext(input: {
	baseURL: string;
	extraHTTPHeaders: Record<string, string>;
	storageState: PortalStorageState;
}): Promise<APIRequestContext> {
	return request.newContext(input);
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
	if (config.authCookieHeader) {
		return parsePortalCookieHeader(config);
	}
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
		seededCookies.push(buildPortalCookie(".muc.edu.cn", SSO_TGC_COOKIE_NAME, ssoToken));
	}
	return seededCookies;
}

function parsePortalCookieHeader(config: CollectorConfig): PortalStorageState["cookies"][number][] {
	const cookieHeader = String(config.authCookieHeader ?? "").trim();
	if (!cookieHeader) {
		return [];
	}
	const portalHost = new URL(config.portalBaseUrl).hostname;
	const cookiesByName = new Map<string, PortalStorageState["cookies"][number]>();
	for (const fragment of cookieHeader.split(";")) {
		const token = fragment.trim();
		if (!token) {
			continue;
		}
		const separator = token.indexOf("=");
		if (separator <= 0) {
			throw new Error(
				"invalid AUTHENTICATED_NOTICE_AUTH_COOKIE_HEADER: expected a Cookie header fragment",
			);
		}
		const name = token.slice(0, separator).trim();
		const value = token.slice(separator + 1).trim();
		if (!(name && value)) {
			throw new Error(
				"invalid AUTHENTICATED_NOTICE_AUTH_COOKIE_HEADER: expected cookie name=value pairs",
			);
		}
		cookiesByName.set(name, {
			domain: name === SSO_TGC_COOKIE_NAME ? ".muc.edu.cn" : portalHost,
			expires: -1,
			httpOnly: true,
			name,
			path: "/",
			sameSite: "Lax",
			secure: true,
			value,
		});
	}
	return [...cookiesByName.values()];
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

function isRecoverablePortalBootstrapError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("net::ERR_TIMED_OUT") ||
		message.includes("Timeout") ||
		message.includes("timed out")
	);
}

import fs from "node:fs";

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
	launchBrowser?: () => Promise<BrowserLike>;
	createRequestContext?: (input: {
		baseURL: string;
		extraHTTPHeaders: Record<string, string>;
		storageState: PortalStorageState;
	}) => Promise<ApiRequestContextLike & DisposableApiContextLike>;
}

export async function launchContextWithStoredAuth(
	config: CollectorConfig = resolveCollectorConfig(process.env),
	launchBrowser: () => Promise<BrowserLike> = defaultLaunchBrowser,
): Promise<{ browserContext: BrowserContextLike; close: () => Promise<void> }> {
	ensureRuntimeDirs(config);
	const browser = await launchBrowser();
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
			return await (dependencies.createRequestContext ?? defaultCreateRequestContext)({
				baseURL: config.portalBaseUrl,
				extraHTTPHeaders: buildPortalApiHeaders(config),
				storageState,
			});
		} finally {
			await page.close?.();
		}
	} finally {
		await close();
	}
}

function defaultLaunchBrowser(): Promise<Browser> {
	return chromium.launch({
		headless: true,
		channel: "chrome",
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

function buildPortalApiHeaders(config: CollectorConfig): Record<string, string> {
	return {
		"x-requested-with": "XMLHttpRequest",
		accept: "application/json, text/plain, */*",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		referer: config.portalPageUrl.replace(/#.*$/, ""),
	};
}

function isRecoverablePortalBootstrapError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("net::ERR_TIMED_OUT") ||
		message.includes("Timeout") ||
		message.includes("timed out")
	);
}

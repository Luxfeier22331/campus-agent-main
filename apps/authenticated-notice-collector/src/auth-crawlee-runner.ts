import fs from "node:fs";
import path from "node:path";

import { PlaywrightCrawler, type RequestOptions } from "crawlee";
import type { BrowserContext } from "playwright";

import type { CollectorConfig } from "./config.js";
import { createAuthenticatedNoticeCrawlerConfiguration } from "./crawlee-runtime.js";

export type AuthPortalStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface AuthPortalCrawlerInput {
	confirmLogin?: () => Promise<void>;
	headless: boolean;
	portalPageUrl: string;
	proxyServer: string | null;
	storageStatePath: string;
	timeoutMs: number;
}

interface AuthPortalCrawlerFactoryInput {
	headless: boolean;
	requestHandler: (context: AuthPortalCrawlerRequestHandlerContext) => Promise<void>;
	proxyServer: string | null;
	storageStatePath: string;
	timeoutMs: number;
}

interface AuthPortalCrawlerRequestHandlerContext {
	page: AuthPortalPageLike;
}

interface AuthPortalPageLike {
	context(): AuthPortalBrowserContextLike;
	goto(
		url: string,
		options?: { timeout?: number; waitUntil?: "domcontentloaded" },
	): Promise<unknown>;
}

interface AuthPortalBrowserContextLike {
	storageState(input?: { path?: string }): Promise<AuthPortalStorageState>;
}

export type AuthPortalCrawlerFactory = (input: AuthPortalCrawlerFactoryInput) => {
	run(requests: RequestOptions[]): Promise<unknown>;
};

export async function runAuthPortalCrawler(
	input: AuthPortalCrawlerInput & { crawlerFactory?: AuthPortalCrawlerFactory },
): Promise<AuthPortalStorageState> {
	let storageState: AuthPortalStorageState | null = null;
	const crawler = (input.crawlerFactory ?? createDefaultAuthPortalCrawler)({
		headless: input.headless,
		proxyServer: input.proxyServer,
		requestHandler: async ({ page }) => {
			await page.goto(input.portalPageUrl, {
				timeout: input.timeoutMs,
				waitUntil: "domcontentloaded",
			});
			await input.confirmLogin?.();
			fs.mkdirSync(path.dirname(input.storageStatePath), { recursive: true });
			storageState = await page.context().storageState({
				path: input.storageStatePath,
			});
		},
		storageStatePath: input.storageStatePath,
		timeoutMs: input.timeoutMs,
	});
	await crawler.run([
		{
			uniqueKey: `auth_portal:${input.portalPageUrl}`,
			url: input.portalPageUrl,
		},
	]);
	if (storageState === null) {
		throw new Error("auth portal crawler did not produce storage state");
	}
	return storageState;
}

export function bootstrapPortalStorageState(input: {
	config: CollectorConfig;
	crawlerFactory?: AuthPortalCrawlerFactory;
	timeoutMs?: number;
}): Promise<AuthPortalStorageState> {
	return runAuthPortalCrawler({
		crawlerFactory: input.crawlerFactory,
		headless: true,
		portalPageUrl: input.config.portalPageUrl,
		proxyServer: input.config.portalProxyServer,
		storageStatePath: input.config.authStorageStatePath,
		timeoutMs: input.timeoutMs ?? 12_000,
	});
}

function createDefaultAuthPortalCrawler(input: AuthPortalCrawlerFactoryInput) {
	const crawler = new PlaywrightCrawler(
		{
			headless: input.headless,
			launchContext: {
				launchOptions: {
					channel: "chrome",
					proxy: input.proxyServer ? { server: input.proxyServer } : undefined,
					timeout: input.timeoutMs,
				},
				useChrome: true,
				useIncognitoPages: true,
			},
			maxRequestRetries: 0,
			navigationTimeoutSecs: Math.ceil(input.timeoutMs / 1000),
			requestHandler: async (context) => {
				await input.requestHandler({
					page: context.page,
				});
			},
		},
		createAuthenticatedNoticeCrawlerConfiguration("auth-portal"),
	);
	return {
		run: async (requests: RequestOptions[]) => await crawler.run(requests),
	};
}

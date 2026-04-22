import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config";

interface LoggerLike {
	log(message: string): void;
}

interface PageLike {
	goto(
		url: string,
		options?: {
			waitUntil?: "domcontentloaded";
		},
	): Promise<unknown>;
}

interface BrowserContextLike {
	newPage(): Promise<PageLike>;
	storageState(input: { path: string }): Promise<unknown>;
}

interface BrowserLike {
	close(): Promise<void>;
	newContext(): Promise<BrowserContextLike>;
}

export interface SaveAuthStorageStateInput {
	authStorageStatePath: string;
	authTimeoutMs: number;
	confirmLogin?: (input: { authTimeoutMs: number; logger: LoggerLike }) => Promise<void>;
	launchBrowser?: () => Promise<BrowserLike>;
	logger?: LoggerLike;
	portalPageUrl: string;
}

export interface SaveAuthStorageStateResult {
	savedTo: string;
}

const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export async function saveAuthStorageState(
	input: SaveAuthStorageStateInput,
): Promise<SaveAuthStorageStateResult> {
	const logger = input.logger ?? console;
	const launchBrowser = input.launchBrowser ?? defaultLaunchBrowser;
	const confirmLogin = input.confirmLogin ?? defaultConfirmLogin;

	const browser = await launchBrowser();
	try {
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(input.portalPageUrl, { waitUntil: "domcontentloaded" });
		await confirmLogin({
			authTimeoutMs: input.authTimeoutMs,
			logger,
		});

		fs.mkdirSync(path.dirname(input.authStorageStatePath), { recursive: true });
		await context.storageState({ path: input.authStorageStatePath });

		return {
			savedTo: input.authStorageStatePath,
		};
	} finally {
		await browser.close();
	}
}

async function defaultLaunchBrowser(): Promise<BrowserLike> {
	return chromium.launch({
		headless: false,
		channel: "chrome",
	});
}

async function defaultConfirmLogin(input: {
	authTimeoutMs: number;
	logger: LoggerLike;
}): Promise<void> {
	input.logger.log("请在打开的浏览器里完成登录。");
	input.logger.log(
		`登录完成后，按 Enter 保存登录态；超时时间 ${Math.round(input.authTimeoutMs / 1000)} 秒。`,
	);
	await Promise.race([
		new Promise<void>((resolve) => {
			process.stdin.resume();
			process.stdin.once("data", () => {
				process.stdin.pause();
				resolve();
			});
		}),
		new Promise<void>((_, reject) => {
			setTimeout(() => {
				process.stdin.pause();
				reject(new Error("login timeout exceeded"));
			}, input.authTimeoutMs);
		}),
	]);
}

function resolveAuthTimeoutMs(source: NodeJS.ProcessEnv): number {
	const raw = Number(source.AUTHENTICATED_NOTICE_AUTH_TIMEOUT_MS || "");
	if (!Number.isFinite(raw) || raw <= 0) {
		return DEFAULT_AUTH_TIMEOUT_MS;
	}
	return Math.floor(raw);
}

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const result = await saveAuthStorageState({
		authStorageStatePath: config.authStorageStatePath,
		authTimeoutMs: resolveAuthTimeoutMs(process.env),
		portalPageUrl: config.portalPageUrl,
	});
	console.log(`storage state saved to ${result.savedTo}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

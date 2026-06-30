import fs from "node:fs";
import path from "node:path";

import { runAuthPortalCrawler } from "./auth-crawlee-runner.js";
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config.js";
import { formatSafeErrorMessage } from "./safe-error.js";

interface LoggerLike {
	log(message: string): void;
}

export interface SaveAuthStorageStateInput {
	authStorageStatePath: string;
	authTimeoutMs: number;
	confirmLogin?: (input: { authTimeoutMs: number; logger: LoggerLike }) => Promise<void>;
	logger?: LoggerLike;
	portalPageUrl: string;
	runAuthPortalCrawler?: (input: {
		confirmLogin: () => Promise<void>;
		headless: boolean;
		portalPageUrl: string;
		proxyServer: string | null;
		storageStatePath: string;
		timeoutMs: number;
	}) => Promise<unknown>;
}

export interface SaveAuthStorageStateResult {
	savedTo: string;
}

const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export async function saveAuthStorageState(
	input: SaveAuthStorageStateInput,
): Promise<SaveAuthStorageStateResult> {
	const logger = input.logger ?? console;
	const confirmLogin = input.confirmLogin ?? defaultConfirmLogin;

	fs.mkdirSync(path.dirname(input.authStorageStatePath), { recursive: true });
	await (input.runAuthPortalCrawler ?? runAuthPortalCrawler)({
		confirmLogin: async () => {
			await confirmLogin({
				authTimeoutMs: input.authTimeoutMs,
				logger,
			});
		},
		headless: false,
		portalPageUrl: input.portalPageUrl,
		proxyServer: null,
		storageStatePath: input.authStorageStatePath,
		timeoutMs: input.authTimeoutMs,
	});
	return {
		savedTo: input.authStorageStatePath,
	};
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
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}

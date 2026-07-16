import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { ensureRuntimeDirs, loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { formatSafeErrorMessage } from "./safe-error.js";

interface LoggerLike {
	log(message: string): void;
}

export interface SaveSsoTgcInput {
	authTimeoutMs: number;
	outputPath: string;
	portalBaseUrl: string;
	proxyServer: string | null;
	captureSsoTgc?: (input: {
		authTimeoutMs: number;
		portalBaseUrl: string;
		proxyServer: string | null;
	}) => Promise<string>;
	logger?: LoggerLike;
}

export async function saveSsoTgc(input: SaveSsoTgcInput): Promise<{ savedTo: string }> {
	const logger = input.logger ?? console;
	logger.log("请在打开的浏览器里完成统一身份认证。");
	const token = await (input.captureSsoTgc ?? captureSsoTgcWithPlaywright)({
		authTimeoutMs: input.authTimeoutMs,
		portalBaseUrl: input.portalBaseUrl,
		proxyServer: input.proxyServer,
	});
	writeSecretFile(input.outputPath, token);
	return { savedTo: input.outputPath };
}

async function captureSsoTgcWithPlaywright(input: {
	authTimeoutMs: number;
	portalBaseUrl: string;
	proxyServer: string | null;
}): Promise<string> {
	const browser = await chromium.launch({
		headless: false,
		proxy: input.proxyServer ? { server: input.proxyServer } : undefined,
	});
	try {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			await page.goto(input.portalBaseUrl, {
				timeout: input.authTimeoutMs,
				waitUntil: "domcontentloaded",
			});
			const portalHost = new URL(input.portalBaseUrl).hostname;
			if (new URL(page.url()).hostname !== portalHost) {
				await page.waitForURL((url) => url.hostname === portalHost, {
					timeout: input.authTimeoutMs,
					waitUntil: "domcontentloaded",
				});
			}
			const state = await context.storageState();
			const token = state.cookies.find((cookie) => cookie.name === "SSO_TGC")?.value.trim();
			if (!token) {
				throw new Error("authenticated browser session did not contain SSO_TGC");
			}
			return token;
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

function writeSecretFile(outputPath: string, value: string): void {
	const directory = path.dirname(outputPath);
	fs.mkdirSync(directory, { mode: 0o700, recursive: true });
	fs.chmodSync(directory, 0o700);
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(temporaryPath, `${value.trim()}\n`, { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(temporaryPath, outputPath);
	fs.chmodSync(outputPath, 0o600);
}

function resolveAuthTimeoutMs(source: NodeJS.ProcessEnv): number {
	const raw = Number(source.INTERNAL_PORTAL_AUTH_TIMEOUT_MS || "");
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5 * 60 * 1000;
}

function resolveOutputPath(args: string[], defaultPath: string): string {
	const outputIndex = args.indexOf("--output");
	if (outputIndex === -1) {
		return defaultPath;
	}
	const output = args[outputIndex + 1]?.trim();
	if (!output) {
		throw new Error("--output requires a file path");
	}
	return path.resolve(output);
}

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const config = resolveInternalPortalConfig(process.env);
	ensureRuntimeDirs(config);
	const result = await saveSsoTgc({
		authTimeoutMs: resolveAuthTimeoutMs(process.env),
		outputPath: resolveOutputPath(process.argv.slice(2), config.authSsoTgcFile),
		portalBaseUrl: config.portalBaseUrl,
		proxyServer: config.portalProxyServer,
	});
	console.log(`SSO_TGC saved to ${result.savedTo}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}

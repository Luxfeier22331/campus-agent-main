import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtractorConfig } from "./types";

function loadEnvFile(): void {
	const envPath = path.resolve(process.cwd(), ".env");
	if (!existsSync(envPath)) return;
	const content = readFileSync(envPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex < 0) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		const value = trimmed.slice(eqIndex + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

loadEnvFile();

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} 未设置。请参考 .env.example 创建 .env 文件。`);
	}
	return value;
}

function optional(env: NodeJS.ProcessEnv, name: string, defaultValue = ""): string {
	return env[name]?.trim() || defaultValue;
}

function booleanFlag(env: NodeJS.ProcessEnv, name: string, defaultValue = false): boolean {
	const raw = env[name]?.trim();
	if (raw === undefined) return defaultValue;
	return raw === "true";
}

function integer(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
	const raw = env[name]?.trim();
	if (!raw) return defaultValue;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

export interface LoadConfigOptions {
	dryRun?: boolean;
	env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions = {}): ExtractorConfig {
	const env = options.env ?? process.env;
	const dryRun = options.dryRun ?? false;
	const username = required(env, "SSO_TGC_EXTRACTOR_USERNAME");
	const password = required(env, "SSO_TGC_EXTRACTOR_PASSWORD");
	const automationUrl = dryRun
		? optional(env, "SSO_TGC_EXTRACTOR_AUTOMATION_URL")
		: required(env, "SSO_TGC_EXTRACTOR_AUTOMATION_URL");
	const automationToken = dryRun
		? optional(env, "SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN")
		: required(env, "SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN");
	const credentialName = dryRun
		? optional(env, "SSO_TGC_EXTRACTOR_CREDENTIAL_NAME")
		: required(env, "SSO_TGC_EXTRACTOR_CREDENTIAL_NAME");

	return {
		username,
		password,
		portalUrl: optional(env, "SSO_TGC_EXTRACTOR_PORTAL_URL", "https://my.muc.edu.cn/"),
		loginUrl: optional(
			env,
			"SSO_TGC_EXTRACTOR_LOGIN_URL",
			"https://ca.muc.edu.cn/zfca/login?service=http%3A%2F%2Fmy.muc.edu.cn%2Fuser%2FsimpleSSOLogin",
		),
		cookieName: optional(env, "SSO_TGC_EXTRACTOR_COOKIE_NAME", "SSO_TGC"),
		headed: booleanFlag(env, "SSO_TGC_EXTRACTOR_HEADED", false),
		retryTimes: integer(env, "SSO_TGC_EXTRACTOR_RETRY_TIMES", 3),
		retryDelay: integer(env, "SSO_TGC_EXTRACTOR_RETRY_DELAY", 5000),
		storageStateDir: optional(env, "SSO_TGC_EXTRACTOR_STORAGE_STATE_DIR"),
		automationUrl,
		automationToken,
		credentialName,
	};
}

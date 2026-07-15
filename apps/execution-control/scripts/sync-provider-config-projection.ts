#!/usr/bin/env node
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_ROLES = ["primary_agent", "rag_query_embedding"];

interface SyncProviderArgs {
	appApiBaseUrl: string;
	output: string;
	roles: string[];
	sharedSecret: string;
}

type Env = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2), process.env);
	const profiles: Record<string, JsonRecord> = {};
	for (const role of args.roles) {
		const profile = await fetchActiveProfile(args, role);
		requireProfile(profile, role);
		profiles[role] = profile;
	}
	const payload = {
		schema_version: "provider_config_projection.v1",
		generated_at: new Date().toISOString(),
		source: {
			app_api_base_url: args.appApiBaseUrl,
			roles: args.roles,
		},
		profiles,
	};
	await writeProjection(args.output, payload);
	console.log(`wrote provider projection ${args.output} (${args.roles.length} roles)`);
}

function parseArgs(argv: string[], env: Env): SyncProviderArgs {
	const values = new Map<string, string>();
	const roles: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) {
			throw new Error(`unexpected argument ${token}`);
		}
		const key = token.slice(2);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${token} requires a non-empty value`);
		}
		if (key === "role") {
			roles.push(value.trim());
		} else {
			values.set(key, value.trim());
		}
		index += 1;
	}
	const appApiBaseUrl =
		values.get("app-api-base-url") ||
		readEnv(env, "APP_API_INTERNAL_BASE_URL") ||
		readEnv(env, "APP_API_BASE_URL");
	const sharedSecret =
		values.get("internal-shared-secret") ||
		readEnv(env, "APP_API_INTERNAL_SHARED_SECRET") ||
		readEnv(env, "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET");
	const output =
		values.get("output") ||
		readEnv(env, "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH") ||
		readEnv(env, "EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH");
	if (!appApiBaseUrl) {
		throw new Error("--app-api-base-url or APP_API_BASE_URL is required");
	}
	if (!sharedSecret) {
		throw new Error("--internal-shared-secret or APP_API_INTERNAL_SHARED_SECRET is required");
	}
	if (!output) {
		throw new Error("--output or CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH is required");
	}
	return {
		appApiBaseUrl: appApiBaseUrl.replace(/\/+$/, ""),
		output,
		roles: roles.length > 0 ? roles : DEFAULT_ROLES,
		sharedSecret,
	};
}

async function fetchActiveProfile(args: SyncProviderArgs, role: string): Promise<unknown> {
	const endpoint = `${args.appApiBaseUrl}/api/internal/provider-config/active?role=${encodeURIComponent(role)}`;
	const response = await fetch(endpoint, {
		headers: { connection: "close", "x-app-internal-auth": args.sharedSecret },
		method: "GET",
		signal: AbortSignal.timeout(10_000),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`active provider profile ${role} returned HTTP ${response.status}: ${text}`);
	}
	const payload = text ? JSON.parse(text) : {};
	return payload.profile;
}

function requireProfile(profile: unknown, role: string): asserts profile is JsonRecord {
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
		throw new Error(`active provider profile ${role} is missing`);
	}
	for (const key of [
		"api_key",
		"base_url",
		"kind",
		"model",
		"profile_id",
		"provider",
		"role",
		"transport",
	]) {
		if (typeof profile[key] !== "string" || !profile[key].trim()) {
			throw new Error(`active provider profile ${role} missing ${key}`);
		}
	}
	if (profile.role !== role) {
		throw new Error(`active provider profile role ${profile.role} does not match ${role}`);
	}
	if (!Number.isInteger(profile.revision) || profile.revision <= 0) {
		throw new Error(`active provider profile ${role} missing revision`);
	}
	if (!Number.isInteger(profile.timeout_ms) || profile.timeout_ms <= 0) {
		throw new Error(`active provider profile ${role} missing timeout_ms`);
	}
	if (
		profile.kind === "embedding" &&
		(!Number.isInteger(profile.dimensions) || profile.dimensions <= 0)
	) {
		throw new Error(`active provider profile ${role} missing dimensions`);
	}
}

async function writeProjection(output: string, payload: unknown): Promise<void> {
	const outputPath = path.resolve(output);
	await mkdir(path.dirname(outputPath), { recursive: true });
	const tempPath = `${outputPath}.tmp-${process.pid}`;
	const handle = await open(tempPath, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
		await handle.close();
		await rename(tempPath, outputPath);
		await chmodOwnerOnly(outputPath);
	} catch (error) {
		await handle.close().catch(noop);
		await rm(tempPath, { force: true }).catch(noop);
		throw error;
	}
}

function noop(): void {
	return;
}

async function chmodOwnerOnly(filePath: string): Promise<void> {
	const { chmod } = await import("node:fs/promises");
	await chmod(filePath, 0o600);
}

function readEnv(env: Env, key: string): string {
	return env[key]?.trim() || "";
}

#!/usr/bin/env node
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

async function main() {
	const args = parseArgs(process.argv.slice(2), process.env);
	const config = await fetchLLMDebugTraceConfig(args);
	validateLLMDebugTraceConfig(config);
	const payload = {
		schema_version: "observability_config_projection.v1",
		generated_at: new Date().toISOString(),
		source: {
			app_api_base_url: args.appApiBaseUrl,
			endpoint: "/api/internal/observability-config/llm-debug-trace",
		},
		llm_debug_trace: config,
	};
	await writeProjection(args.output, payload);
	console.log(
		[
			`wrote observability projection ${args.output}`,
			`mode=${config.mode}`,
			`sample_ratio=${config.sample_ratio}`,
			`auth_header=${authHeaderStatus(config)}`,
			`endpoint=${endpointSummary(config)}`,
		].join(" "),
	);
}

function parseArgs(argv, env) {
	const values = new Map();
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
		values.set(key, value.trim());
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
		readEnv(env, "CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_HOST_PATH") ||
		readEnv(env, "CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH");
	if (!appApiBaseUrl) {
		throw new Error("--app-api-base-url or APP_API_BASE_URL is required");
	}
	if (!sharedSecret) {
		throw new Error("--internal-shared-secret or APP_API_INTERNAL_SHARED_SECRET is required");
	}
	if (!output) {
		throw new Error("--output or CAMPUS_OBSERVABILITY_CONFIG_SNAPSHOT_PATH is required");
	}
	return {
		appApiBaseUrl: appApiBaseUrl.replace(/\/+$/, ""),
		output,
		sharedSecret,
	};
}

async function fetchLLMDebugTraceConfig(args) {
	const endpoint = `${args.appApiBaseUrl}/api/internal/observability-config/llm-debug-trace`;
	const response = await fetch(endpoint, {
		headers: { "x-app-internal-auth": args.sharedSecret },
		method: "GET",
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`LLM debug trace config returned HTTP ${response.status}: ${text}`);
	}
	const payload = text ? JSON.parse(text) : {};
	return payload.config;
}

function validateLLMDebugTraceConfig(config) {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error("LLM debug trace config is missing");
	}
	if (config.schema_version !== "llm_debug_trace_config.v1") {
		throw new Error("LLM debug trace config schema_version is invalid");
	}
	if (config.mode !== "off" && config.mode !== "langfuse_otlp") {
		throw new Error("LLM debug trace config mode is invalid");
	}
	if (config.include_model_io !== false) {
		throw new Error("LLM debug trace config include_model_io must be false");
	}
	if (
		typeof config.sample_ratio !== "number" ||
		!Number.isFinite(config.sample_ratio) ||
		config.sample_ratio < 0 ||
		config.sample_ratio > 1
	) {
		throw new Error("LLM debug trace config sample_ratio must be between 0 and 1");
	}
	if (config.mode === "off") {
		return;
	}
	if (
		!config.langfuse_otlp ||
		typeof config.langfuse_otlp !== "object" ||
		Array.isArray(config.langfuse_otlp)
	) {
		throw new Error("LLM debug trace config langfuse_otlp is required");
	}
	const endpoint = String(config.langfuse_otlp.endpoint || "")
		.trim()
		.replace(/\/+$/u, "");
	if (!endpoint.endsWith("/api/public/otel")) {
		throw new Error("LLM debug trace Langfuse OTLP endpoint must end with /api/public/otel");
	}
	if (!String(config.langfuse_otlp.auth_header || "").startsWith("Basic ")) {
		throw new Error("LLM debug trace Langfuse OTLP auth_header must use Basic auth");
	}
}

async function writeProjection(output, payload) {
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

function authHeaderStatus(config) {
	if (config.mode !== "langfuse_otlp") {
		return "not_required";
	}
	return config.langfuse_otlp?.auth_header ? "configured" : "missing";
}

function endpointSummary(config) {
	if (config.mode !== "langfuse_otlp") {
		return "none";
	}
	try {
		const endpoint = new URL(config.langfuse_otlp.endpoint);
		return `${endpoint.host}${endpoint.pathname}`;
	} catch {
		return "invalid";
	}
}

function noop() {
	return;
}

async function chmodOwnerOnly(filePath) {
	const { chmod } = await import("node:fs/promises");
	await chmod(filePath, 0o600);
}

function readEnv(env, key) {
	return env[key]?.trim() || "";
}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadStagingSmokeEnvFile } from "./load-repo-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

loadStagingSmokeEnvFile(import.meta.url, "..");

const REQUIRED_ENV_KEYS = [
	"LANGFUSE_BASE_URL",
	"LANGFUSE_PUBLIC_KEY",
	"LANGFUSE_SECRET_KEY",
	"LANGFUSE_ENVIRONMENT",
	"EXECUTION_CONTROL_RUNTIME_RELEASE",
];
const LANGFUSE_OTLP_PATH = "/api/public/otel";
const LANGFUSE_INGESTION_VERSION = "4";

const DEFAULT_OUTPUT_DIR = ".tmp/e2e-qa/langfuse-closeout";
const DEFAULT_PROFILE_REPORT = `${DEFAULT_OUTPUT_DIR}/online-answer-path/profile-report.json`;
const DEFAULT_DURABLE_CHAT_ARTIFACT = `${DEFAULT_OUTPUT_DIR}/chat-durable-reconnect.json`;

function parseArgs(argv) {
	const parsed = {
		durableChatArtifact: DEFAULT_DURABLE_CHAT_ARTIFACT,
		environment: process.env.LANGFUSE_ENVIRONMENT?.trim() || "",
		outputDir: DEFAULT_OUTPUT_DIR,
		profileReport: DEFAULT_PROFILE_REPORT,
		release: process.env.EXECUTION_CONTROL_RUNTIME_RELEASE?.trim() || "",
		tags: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--output-dir") {
			parsed.outputDir = requireValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--profile-report") {
			parsed.profileReport = requireValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--durable-chat-artifact") {
			parsed.durableChatArtifact = requireValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--environment") {
			parsed.environment = requireValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--release") {
			parsed.release = requireValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--tag") {
			parsed.tags.push(requireValue(argv, index, token));
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}

	if (parsed.tags.length === 0 && parsed.environment) {
		parsed.tags = ["surface:execution-control", "capability:knowledge", `env:${parsed.environment}`];
	}

	return parsed;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1]?.trim();
	if (!value) {
		throw new Error(`${flag} requires a non-empty value.`);
	}
	return value;
}

function resolveRepoPath(value) {
	return resolve(repoRoot, value);
}

function requireExistingFile(path, label) {
	if (!existsSync(path)) {
		throw new Error(`${label} does not exist: ${path}`);
	}
}

function run(command, args) {
	const completed = spawnSync(command, args, {
		cwd: repoRoot,
		env: process.env,
		stdio: "inherit",
	});
	if (completed.error) {
		throw completed.error;
	}
	return completed.status ?? 1;
}

function main() {
	const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]?.trim());
	if (missing.length > 0) {
		console.error(`Missing required Langfuse staging closeout env: ${missing.join(", ")}`);
		return 1;
	}
	const derivationError = deriveLangfuseCollectorEnv();
	if (derivationError) {
		console.error(derivationError);
		return 1;
	}

	const args = parseArgs(process.argv.slice(2));
	if (!args.environment) {
		console.error("environment is required.");
		return 1;
	}
	if (!args.release) {
		console.error("release is required.");
		return 1;
	}

	const outputDir = resolveRepoPath(args.outputDir);
	const profileReport = resolveRepoPath(args.profileReport);
	const durableChatArtifact = resolveRepoPath(args.durableChatArtifact);
	requireExistingFile(profileReport, "profile report");
	requireExistingFile(durableChatArtifact, "durable chat artifact");

	const closeoutArgs = [
		"run",
		"--all-packages",
		"python",
		"-m",
		"scripts.run_langfuse_release_evidence_closeout",
		"--output-dir",
		outputDir,
		"--profile-report",
		profileReport,
		"--environment",
		args.environment,
		"--release",
		args.release,
		"--durable-chat-artifact",
		durableChatArtifact,
	];
	for (const tag of args.tags) {
		closeoutArgs.push("--tag", tag);
	}

	const closeoutStatus = run("uv", closeoutArgs);
	if (closeoutStatus !== 0) {
		return closeoutStatus;
	}

	return run("uv", [
		"run",
		"--all-packages",
		"python",
		"-m",
		"scripts.check_langfuse_release_evidence",
		resolve(outputDir, "langfuse-release-evidence.json"),
	]);
}

function deriveLangfuseCollectorEnv() {
	const baseUrl = normalizeBaseUrl(process.env.LANGFUSE_BASE_URL);
	if (!baseUrl) {
		return "LANGFUSE_BASE_URL must be a valid URL.";
	}
	const expectedEndpoint = `${baseUrl}${LANGFUSE_OTLP_PATH}`;
	const existingEndpoint = process.env.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT?.trim();
	if (existingEndpoint && existingEndpoint !== expectedEndpoint) {
		return "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT must be derived from LANGFUSE_BASE_URL.";
	}
	process.env.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT = expectedEndpoint;

	const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim() || "";
	const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim() || "";
	const expectedAuthHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
	const existingAuthHeader = process.env.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER?.trim();
	if (existingAuthHeader && existingAuthHeader !== expectedAuthHeader) {
		return "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER must be derived from LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.";
	}
	process.env.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER = expectedAuthHeader;

	const existingVersion = process.env.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION?.trim();
	if (existingVersion && existingVersion !== LANGFUSE_INGESTION_VERSION) {
		return `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION must be ${LANGFUSE_INGESTION_VERSION}.`;
	}
	process.env.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION = LANGFUSE_INGESTION_VERSION;
	return "";
}

function normalizeBaseUrl(value) {
	const raw = value?.trim();
	if (!raw) {
		return "";
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return "";
		}
		url.pathname = url.pathname.replace(/\/+$/, "");
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return "";
	}
}

try {
	process.exitCode = main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

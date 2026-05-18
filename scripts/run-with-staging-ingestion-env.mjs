import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

try {
	process.loadEnvFile(resolve(repoRoot, ".env.staging.local"));
} catch (error) {
	if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
		throw error;
	}
}

const REQUIRED_MAPPINGS = [
	["STAGING_INGESTION_SHARED_POSTGRES_URL", "CAMPUS_SHARED_POSTGRES_URL"],
	["STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "OBJECT_STORE_ENDPOINT"],
];

const OPTIONAL_MAPPINGS = [
	["STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL", "DOCUMENT_REGISTRY_DATABASE_URL"],
	["STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL", "RAW_ASSET_REGISTRY_DATABASE_URL"],
	["STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL", "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"],
	[
		"STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
		"DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
	],
	["STAGING_INGESTION_OBJECT_STORE_REGION", "OBJECT_STORE_REGION"],
	["STAGING_INGESTION_OBJECT_STORE_BUCKET_SOURCE", "OBJECT_STORE_BUCKET_SOURCE"],
	["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
	["STAGING_INGESTION_OBJECT_STORE_SECURE", "OBJECT_STORE_SECURE"],
	["STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_SOURCE_ACCESS_KEY", "OBJECT_STORE_SOURCE_ACCESS_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_SOURCE_SECRET_KEY", "OBJECT_STORE_SOURCE_SECRET_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_ACCESS_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"],
	["STAGING_INGESTION_QDRANT_URL", "QDRANT_URL"],
	["STAGING_INGESTION_QDRANT_API_KEY", "QDRANT_API_KEY"],
	["STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS", "QDRANT_TIMEOUT_SECONDS"],
	["STAGING_INGESTION_QDRANT_UPSERT_BATCH_SIZE", "QDRANT_UPSERT_BATCH_SIZE"],
	["STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS", "INGESTION_QDRANT_TIMEOUT_SECONDS"],
	["STAGING_INGESTION_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"],
	["STAGING_INGESTION_EMBEDDING_MODEL", "EMBEDDING_MODEL"],
	["STAGING_INGESTION_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
	["STAGING_INGESTION_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL"],
	["STAGING_INGESTION_EMBEDDING_DIMENSIONS", "EMBEDDING_DIMENSIONS"],
	["STAGING_INGESTION_EMBEDDING_TIMEOUT_SECONDS", "EMBEDDING_TIMEOUT_SECONDS"],
	["STAGING_INGESTION_EMBEDDING_BATCH_SIZE", "EMBEDDING_BATCH_SIZE"],
	["STAGING_INGESTION_SPARSE_PROVIDER", "SPARSE_PROVIDER"],
	["STAGING_INGESTION_SPARSE_MODEL", "SPARSE_MODEL"],
	["STAGING_INGESTION_SPARSE_TOKENIZER", "SPARSE_TOKENIZER"],
	["STAGING_INGESTION_SPARSE_LANGUAGE", "SPARSE_LANGUAGE"],
];

function fail(message) {
	console.error(message);
	process.exit(1);
}

function requiredEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		fail(`${name} is required.`);
	}
	return value;
}

function envValue(name) {
	return process.env[name]?.trim() || "";
}

function hasPair(accessKeyName, secretKeyName) {
	return Boolean(envValue(accessKeyName) && envValue(secretKeyName));
}

function requireCompletePair(accessKeyName, secretKeyName) {
	const hasAccessKey = Boolean(envValue(accessKeyName));
	const hasSecretKey = Boolean(envValue(secretKeyName));
	if (hasAccessKey === hasSecretKey) {
		return;
	}
	fail(`${accessKeyName} and ${secretKeyName} must be configured together.`);
}

for (const [source, target] of REQUIRED_MAPPINGS) {
	process.env[target] = requiredEnv(source);
}

for (const [source, target] of OPTIONAL_MAPPINGS) {
	const value = process.env[source]?.trim();
	if (value) {
		process.env[target] = value;
	}
}

requireCompletePair(
	"STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
	"STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
);
requireCompletePair(
	"STAGING_INGESTION_OBJECT_STORE_SOURCE_ACCESS_KEY",
	"STAGING_INGESTION_OBJECT_STORE_SOURCE_SECRET_KEY",
);
requireCompletePair(
	"STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
	"STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
);
if (
	!(
		hasPair(
			"STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
			"STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
		) ||
		hasPair(
			"STAGING_INGESTION_OBJECT_STORE_SOURCE_ACCESS_KEY",
			"STAGING_INGESTION_OBJECT_STORE_SOURCE_SECRET_KEY",
		) ||
		hasPair(
			"STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
			"STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
		)
	)
) {
	fail(
		"staging ingestion object-store credentials are required: configure shared, source, or derived credential pair.",
	);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
	fail("Usage: node scripts/run-with-staging-ingestion-env.mjs <command> [args...]");
}

const child = spawn(command, args, {
	cwd: process.cwd(),
	env: process.env,
	shell: process.platform === "win32",
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, "../.generated/runtime.env");

const requiredSecrets = [
	"APP_API_INTERNAL_SHARED_SECRET",
	"APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY",
	"PERSONAL_MEMORY_API_SECRET",
	"PERSONAL_MEMORY_OWNER_SALT",
	"TEMPORAL_POSTGRES_PASSWORD",
	"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
	"HINDSIGHT_POSTGRES_PASSWORD",
	"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
	"EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
	"QDRANT_API_KEY",
	"QDRANT_READ_ONLY_API_KEY",
	"LANGFUSE_NEXTAUTH_SECRET",
	"LANGFUSE_SALT",
	"LANGFUSE_ENCRYPTION_KEY",
	"LANGFUSE_POSTGRES_PASSWORD",
	"LANGFUSE_CLICKHOUSE_PASSWORD",
	"LANGFUSE_REDIS_AUTH",
	"LANGFUSE_MINIO_ROOT_PASSWORD",
	"LANGFUSE_INIT_PROJECT_PUBLIC_KEY",
	"LANGFUSE_INIT_PROJECT_SECRET_KEY",
	"LANGFUSE_INIT_USER_PASSWORD",
];
const retiredGeneratedSecrets = [
	"ZEP_CE_API_IMAGE",
	"ZEP_CE_CONFIG_PATH",
	"ZEP_CE_MODEL_NAME",
	"ZEP_CE_NEO4J_PASSWORD",
	"ZEP_CE_OPENAI_API_KEY",
	"ZEP_CE_OPENAI_BASE_URL",
	"ZEP_CE_POSTGRES_PASSWORD",
];

export async function ensureRuntimeSecrets(input = {}) {
	const envPath = input.envPath ?? defaultEnvPath;
	const existing = await readEnvFile(envPath);
	let changed = false;

	for (const key of retiredGeneratedSecrets) {
		if (existing.delete(key)) {
			changed = true;
		}
	}

	for (const key of requiredSecrets) {
		if (!existing.has(key)) {
			existing.set(key, randomValueForKey(key));
			changed = true;
		}
	}

	await mkdir(path.dirname(envPath), { recursive: true });
	if (changed || !(await fileExists(envPath))) {
		await writeFile(envPath, serializeEnv(existing), { mode: 0o600 });
		if (process.platform !== "win32") {
			await chmod(envPath, 0o600);
		}
	} else if (process.platform !== "win32") {
		const currentMode = (await stat(envPath)).mode & 0o777;
		if (currentMode !== 0o600) {
			await chmod(envPath, 0o600);
		}
	}

	return { envPath };
}

async function readEnvFile(envPath) {
	try {
		const content = await readFile(envPath, "utf8");
		return parseEnv(content);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return new Map();
		}
		throw error;
	}
}

function parseEnv(content) {
	const parsed = new Map();
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (key) {
			parsed.set(key, value);
		}
	}
	return parsed;
}

function serializeEnv(values) {
	return `${[...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function randomSecret() {
	return randomBytes(32).toString("base64url");
}

function randomHexSecret() {
	return randomBytes(32).toString("hex");
}

function randomValueForKey(key) {
	switch (key) {
		case "LANGFUSE_ENCRYPTION_KEY":
			return randomHexSecret();
		case "LANGFUSE_INIT_PROJECT_PUBLIC_KEY":
			return `pk-lf-local-${randomSecret()}`;
		case "LANGFUSE_INIT_PROJECT_SECRET_KEY":
			return `sk-lf-local-${randomSecret()}`;
		default:
			return randomSecret();
	}
}

async function fileExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { envPath } = await ensureRuntimeSecrets();
	console.log(`Self-host runtime secrets are available at ${envPath}`);
}

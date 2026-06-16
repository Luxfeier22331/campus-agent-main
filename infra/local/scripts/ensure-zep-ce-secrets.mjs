import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, "../.generated/zep-ce.env");

const requiredSecrets = [
	"PERSONAL_MEMORY_API_SECRET",
	"PERSONAL_MEMORY_OWNER_SALT",
	"ZEP_CE_POSTGRES_PASSWORD",
	"ZEP_CE_NEO4J_PASSWORD",
];
const retiredGeneratedSecrets = ["ZEP_CE_OPENAI_API_KEY"];

export async function ensureZepCeSecrets(input = {}) {
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
			existing.set(key, randomSecret());
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
	const { envPath } = await ensureZepCeSecrets();
	console.log(`Zep CE local secrets are available at ${envPath}`);
}

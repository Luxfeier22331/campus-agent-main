import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const OBJECT_STORE_ENV_KEYS = [
	"OBJECT_STORE_BUCKET_DERIVED",
	"OBJECT_STORE_DERIVED_ACCESS_KEY",
	"OBJECT_STORE_DERIVED_SECRET_KEY",
	"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
	"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
	"OBJECT_STORE_ENDPOINT",
] as const;

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

export function loadCampusWebBuildEnvironment(
	input: { appRoot?: string; processEnvironment?: NodeJS.ProcessEnv; repoRoot?: string } = {},
): NodeJS.ProcessEnv {
	const appRoot = resolve(input.appRoot ?? APP_ROOT);
	const repoRoot = resolve(input.repoRoot ?? REPO_ROOT);
	return {
		...readOptionalEnvironment(resolve(appRoot, ".dev.vars.local")),
		...readOptionalEnvironment(resolve(repoRoot, "env/commands/campus-docs-source.env")),
		...(input.processEnvironment ?? process.env),
	};
}

export function omitObjectStoreEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const sanitized = { ...env };
	for (const key of OBJECT_STORE_ENV_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}

function readOptionalEnvironment(path: string): NodeJS.ProcessEnv {
	return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

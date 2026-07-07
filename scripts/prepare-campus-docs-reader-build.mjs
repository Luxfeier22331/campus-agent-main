import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appApiDir = resolve(repoRoot, "apps/app-api");
const campusWebDir = resolve(repoRoot, "apps/campus-web");
const DEFAULT_PUBLIC_DOCS_SYNC_MANIFEST_PATH = "var/public-docs-sync-manifest.json";
const REQUIRED_BASE_ENV_KEYS = [
	"APP_API_OPERATOR_DATABASE_URL",
	"OBJECT_STORE_ENDPOINT",
	"OBJECT_STORE_BUCKET_DERIVED",
];
const SHARED_OBJECT_STORE_CREDENTIAL_KEYS = ["OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_SECRET_KEY"];
const DERIVED_OBJECT_STORE_CREDENTIAL_KEYS = [
	"OBJECT_STORE_DERIVED_ACCESS_KEY",
	"OBJECT_STORE_DERIVED_SECRET_KEY",
];

export function parsePrepareDocsReaderBuildArgs(argv) {
	const options = {
		publicDocsSyncManifestPath: DEFAULT_PUBLIC_DOCS_SYNC_MANIFEST_PATH,
		readModelManifestPath: undefined,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--read-model-manifest" || token === "--public-docs-sync-manifest") {
			const value = argv[index + 1]?.trim();
			if (!value || value.startsWith("--")) {
				throw new Error(`${token} requires a value.`);
			}
			if (token === "--read-model-manifest") {
				options.readModelManifestPath = value;
			} else {
				options.publicDocsSyncManifestPath = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`unknown docs reader prepare argument: ${token}`);
	}
	return options;
}

export function resolvePrepareDocsReaderBuildEnv(env) {
	const missing = REQUIRED_BASE_ENV_KEYS.filter((key) => !env[key]?.trim());
	const credentialMode = resolveObjectStoreCredentialMode(env);
	if (!credentialMode) {
		missing.push("object-store credentials");
	}
	if (missing.length > 0) {
		throw new Error(`Missing required docs reader build env: ${missing.join(", ")}`);
	}
	const result = Object.fromEntries(REQUIRED_BASE_ENV_KEYS.map((key) => [key, env[key].trim()]));
	result.OBJECT_STORE_CREDENTIAL_MODE = credentialMode;
	return result;
}

function resolveObjectStoreCredentialMode(env) {
	if (hasEnvPair(env, SHARED_OBJECT_STORE_CREDENTIAL_KEYS)) {
		return "shared";
	}
	if (hasEnvPair(env, DERIVED_OBJECT_STORE_CREDENTIAL_KEYS)) {
		return "derived";
	}
}

function hasEnvPair(env, keys) {
	return keys.every((key) => env[key]?.trim());
}

export function loadPrepareDocsReaderBuildEnvFiles(
	env,
	{ defaultEnvFiles = [], overrideEnvFiles = [] },
) {
	const lockedKeys = new Set(
		Object.entries(env)
			.filter(([, value]) => typeof value === "string" && value.trim())
			.map(([key]) => key),
	);
	for (const path of defaultEnvFiles) {
		loadEnvFileIntoEnv(env, path, { lockedKeys, overrideExisting: false });
	}
	for (const path of overrideEnvFiles) {
		loadEnvFileIntoEnv(env, path, { lockedKeys, overrideExisting: true });
	}
}

function loadLocalEnv() {
	loadPrepareDocsReaderBuildEnvFiles(process.env, {
		defaultEnvFiles: [
			resolve(repoRoot, ".env"),
			resolve(appApiDir, ".env"),
			resolve(appApiDir, ".dev.vars"),
			resolve(campusWebDir, ".env"),
		],
		overrideEnvFiles: [resolve(repoRoot, "env/commands/campus-docs-reader-build.env")],
	});
}

function loadEnvFileIntoEnv(env, path, { lockedKeys, overrideExisting }) {
	if (!existsSync(path)) {
		return;
	}
	const parsed = parseEnv(readFileSync(path, "utf8"));
	for (const [key, value] of Object.entries(parsed)) {
		if (lockedKeys.has(key)) {
			continue;
		}
		if (overrideExisting || !env[key]?.trim()) {
			env[key] = value;
		}
	}
}

function run(command, args, options) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status === 0) {
		return result.stdout.trim();
	}
	if (result.stdout) {
		process.stdout.write(result.stdout);
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	process.exit(result.status ?? 1);
}

function runAppApiScript(scriptName, args) {
	return run(
		process.execPath,
		["./scripts/run-with-local-env.mjs", "pnpm", "exec", "tsx", `./scripts/${scriptName}`, ...args],
		{ cwd: appApiDir },
	);
}

function runCampusWebScript(scriptName, args) {
	return run(
		process.execPath,
		["./scripts/run-with-local-env.mjs", "node", `./scripts/${scriptName}`, ...args],
		{
			cwd: campusWebDir,
		},
	);
}

function parseJsonOutput(output) {
	const line = output
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean)
		.at(-1);
	return line ? JSON.parse(line) : {};
}

async function main() {
	loadLocalEnv();
	resolvePrepareDocsReaderBuildEnv(process.env);
	const options = parsePrepareDocsReaderBuildArgs(process.argv.slice(2));
	const manifestPath = resolve(repoRoot, options.publicDocsSyncManifestPath);
	mkdirSync(dirname(manifestPath), { recursive: true });

	let imported;
	if (options.readModelManifestPath) {
		imported = parseJsonOutput(
			runAppApiScript("import-docs-read-model.ts", [
				relative(appApiDir, resolve(repoRoot, options.readModelManifestPath)),
			]),
		);
	}

	runAppApiScript("export-public-docs-sync-manifest.ts", [relative(appApiDir, manifestPath)]);
	const checked = parseJsonOutput(
		runCampusWebScript("sync-campus-published-reader.mjs", [
			"check",
			"--manifest-path",
			relative(campusWebDir, manifestPath),
		]),
	);
	console.log(
		JSON.stringify({
			checked,
			imported,
			publicDocsSyncManifestPath: relative(repoRoot, manifestPath),
		}),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}

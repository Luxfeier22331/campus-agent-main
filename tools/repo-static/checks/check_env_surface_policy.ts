import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";
import { trackedEnvExampleFiles } from "./check_env_example_tracked.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const defaultPolicyPath = "configs/runtime/env-surface-policy.v1.json";
const envEntryPattern = /^([A-Z][A-Z0-9_]*)=/;
const secretLikeKeyPattern =
	/(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|DSN|TOKEN|SALT)/i;
const rootForbiddenPrefixes = [
	"LLM_",
	"EMBEDDING_",
	"RERANK_",
	"PUBLIC_WEB_SEARCH_",
	"OBJECT_STORE_",
	"QDRANT_",
	"OTEL_",
	"LANGFUSE_",
	"SENTRY_",
	"AUTHENTICATED_NOTICE_",
	"OFFICIAL_WEB_",
	"WECHAT_OFFICIAL_ACCOUNT_",
];
const rootAllowedKeys = new Set([
	"CAMPUS_SHARED_POSTGRES_URL",
	"CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
]);

export interface EnvPolicy {
	allowedTemplates: Set<string>;
	keyScopes: Map<string, Set<string>>;
	prefixScopes: Map<string, Set<string>>;
	retiredKeys: Set<string>;
	retiredScanPaths: string[];
	templateKeyLimits: Map<string, number>;
}

export function loadEnvSurfacePolicy(path: string): EnvPolicy {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	if (raw.schema_version !== "campus_env_surface_policy.v1") {
		throw new Error("env surface policy schema_version must be campus_env_surface_policy.v1");
	}
	const keys = objectValue(raw.keys, "keys");
	const prefixes = objectValue(raw.allowed_prefixes ?? {}, "allowed_prefixes");
	const templateLimits = objectValue(raw.template_key_limits ?? {}, "template_key_limits");

	const keyScopes = new Map<string, Set<string>>();
	const retiredKeys = new Set<string>();
	for (const [key, specRaw] of Object.entries(keys)) {
		if (key === "") {
			throw new Error("env surface policy key names must be non-empty strings");
		}
		const spec = objectValue(specRaw, `key ${key}`);
		if (spec.retired === true) {
			retiredKeys.add(key);
		}
		keyScopes.set(key, new Set(stringList(spec.scopes ?? [], `key ${key} scopes`)));
	}

	const prefixScopes = new Map<string, Set<string>>();
	for (const [prefix, scopes] of Object.entries(prefixes)) {
		if (prefix === "") {
			throw new Error("env surface policy prefixes must be non-empty strings");
		}
		prefixScopes.set(prefix, new Set(stringList(scopes, `prefix ${prefix}`)));
	}

	const parsedTemplateLimits = new Map<string, number>();
	for (const [name, limit] of Object.entries(templateLimits)) {
		parsedTemplateLimits.set(name, positiveInt(limit, `template_key_limits.${name}`));
	}

	return {
		allowedTemplates: new Set(stringList(raw.allowed_templates ?? [], "allowed_templates")),
		keyScopes,
		prefixScopes,
		retiredKeys,
		retiredScanPaths: stringList(raw.retired_scan_paths ?? [], "retired_scan_paths"),
		templateKeyLimits: parsedTemplateLimits,
	};
}

export function auditEnvSurfacePolicy({
	root = repoRoot,
	policyPath = join(root, defaultPolicyPath),
}: {
	root?: string;
	policyPath?: string;
} = {}): string[] {
	const policy = loadEnvSurfacePolicy(policyPath);
	const failures: string[] = [];
	for (const templatePath of envTemplateFiles(root)) {
		const relativePath = relativePosix(root, templatePath);
		const scope = templateScope(relativePath);
		if (!policy.allowedTemplates.has(relativePath)) {
			failures.push(`${templatePath}: env template is not registered in env surface policy`);
			continue;
		}
		const envKeys = iterEnvSurfaceKeys(templatePath);
		const limit = policy.templateKeyLimits.get(relativePath);
		if (limit !== undefined && envKeys.length > limit) {
			failures.push(
				`${templatePath}: declares ${envKeys.length} env keys, exceeds policy limit ${limit}`,
			);
		}
		for (const [lineNumber, key] of envKeys) {
			if (policy.retiredKeys.has(key)) {
				failures.push(`${templatePath}:${lineNumber}: retired env key '${key}'`);
				continue;
			}
			if (
				scope === "root" &&
				(!rootAllowedKeys.has(key) ||
					rootForbiddenPrefixes.some((prefix) => key.startsWith(prefix)))
			) {
				failures.push(
					`${templatePath}:${lineNumber}: root env key '${key}' is outside the shared root env contract`,
				);
				continue;
			}
			if (isSecretLikeKey(key) && !policy.keyScopes.has(key)) {
				failures.push(
					`${templatePath}:${lineNumber}: secret-like env key '${key}' must be explicitly registered`,
				);
				continue;
			}
			if (!keyAllowedForScope(key, scope, policy)) {
				failures.push(
					`${templatePath}:${lineNumber}: unregistered env key '${key}' for scope '${scope}'`,
				);
			}
		}
	}
	failures.push(...auditRetiredKeyText(root, policy));
	return failures;
}

function envTemplateFiles(root: string): string[] {
	if (existsSync(join(root, ".git"))) {
		return trackedEnvExampleFiles(root);
	}
	return walkFiles(root)
		.filter((path) =>
			[".env.example", ".dev.vars.example", ".local.example"].some((suffix) =>
				path.endsWith(suffix),
			),
		)
		.filter((path) => !relativePosix(root, path).includes("/vendor/"))
		.sort();
}

function iterEnvSurfaceKeys(path: string): [number, string][] {
	const keys: [number, string][] = [];
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	for (const [index, rawLine] of lines.entries()) {
		const match = rawLine.match(envEntryPattern);
		if (match?.[1]) {
			keys.push([index + 1, match[1]]);
		}
	}
	return keys;
}

function templateScope(relativePath: string): string {
	if (relativePath === ".env.example") {
		return "root";
	}
	if (relativePath.startsWith("env/commands/")) {
		return "command";
	}
	if (relativePath.startsWith("infra/")) {
		return "infra";
	}
	if (relativePath.startsWith("apps/")) {
		return relativePath.split("/", 2)[1] ?? "unknown";
	}
	return "unknown";
}

function keyAllowedForScope(key: string, scope: string, policy: EnvPolicy): boolean {
	if (policy.keyScopes.get(key)?.has(scope)) {
		return true;
	}
	for (const [prefix, scopes] of policy.prefixScopes) {
		if (key.startsWith(prefix) && scopes.has(scope)) {
			return true;
		}
	}
	return false;
}

export function isSecretLikeKey(key: string): boolean {
	return secretLikeKeyPattern.test(key);
}

function auditRetiredKeyText(root: string, policy: EnvPolicy): string[] {
	if (policy.retiredKeys.size === 0 || !existsSync(join(root, ".git"))) {
		return [];
	}
	const failures: string[] = [];
	for (const path of worktreePaths(root, policy.retiredScanPaths)) {
		const relativePath = relativePosix(root, path);
		if (
			!statSync(path).isFile() ||
			relativePath.includes("/node_modules/") ||
			relativePath.includes("/vendor/") ||
			relativePath.includes("/.git/")
		) {
			continue;
		}
		const text = readFileSync(path, "utf8");
		for (const key of [...policy.retiredKeys].sort()) {
			if (text.includes(key)) {
				failures.push(`${path}: retired env key '${key}' appears in tracked text`);
			}
		}
	}
	return failures;
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(path));
		} else if (entry.isFile()) {
			result.push(path);
		}
	}
	return result;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`env surface policy ${name} must be an object`);
	}
	return value as Record<string, unknown>;
}

function stringList(value: unknown, name: string): string[] {
	if (!(Array.isArray(value) && value.every((item) => typeof item === "string"))) {
		throw new Error(`env surface policy ${name} must be a string list`);
	}
	return value;
}

function positiveInt(value: unknown, name: string): number {
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new Error(`env surface policy ${name} must be a positive integer`);
	}
	return Number(value);
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "env-surface-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function writePolicy(root: string, payload: object): string {
	const path = join(root, "configs", "runtime", "env-surface-policy.v1.json");
	writeText(path, `${JSON.stringify(payload, null, 2)}\n`);
	return path;
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function expectMatch(value: string, pattern: RegExp, label: string): void {
	if (!pattern.test(value)) {
		throw new Error(`${label} mismatch: ${value}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		writeText(join(root, ".env.example"), "AGENT_PROMPT_MODEL=gpt-test\n");
		const policyPath = writePolicy(root, {
			schema_version: "campus_env_surface_policy.v1",
			allowed_templates: [".env.example"],
			keys: {
				AGENT_PROMPT_MODEL: {
					owner: "retired",
					scopes: [],
					secret: false,
					retired: true,
				},
			},
		});
		const failures = auditEnvSurfacePolicy({ root, policyPath });
		expect(failures.length === 1, "retired key failures count mismatch");
		expectMatch(failures[0] ?? "", /retired env key 'AGENT_PROMPT_MODEL'/, "retired key rejection");
	});
	withFixture((root) => {
		writeText(join(root, ".env.example"), "UNKNOWN_ENV_KEY=value\n");
		const policyPath = writePolicy(root, {
			schema_version: "campus_env_surface_policy.v1",
			allowed_templates: [".env.example"],
			keys: {},
		});
		const failures = auditEnvSurfacePolicy({ root, policyPath });
		expect(failures.length === 1, "unknown root key failures count mismatch");
		expectMatch(
			failures[0] ?? "",
			/root env key 'UNKNOWN_ENV_KEY' is outside the shared root env contract/,
			"unknown root key rejection",
		);
	});
	withFixture((root) => {
		writeText(join(root, "apps", "sample", ".dev.vars.example"), "SAMPLE_PUBLIC=value\n");
		const policyPath = writePolicy(root, {
			schema_version: "campus_env_surface_policy.v1",
			allowed_templates: ["apps/sample/.dev.vars.example"],
			allowed_prefixes: {
				SAMPLE_: ["sample"],
			},
			keys: {},
			template_key_limits: {
				"apps/sample/.dev.vars.example": 1,
			},
		});
		expectEqualJson(auditEnvSurfacePolicy({ root, policyPath }), [], "allowed prefix policy");
	});
	console.log("check_env_surface_policy self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = auditEnvSurfacePolicy();
	if (failures.length > 0) {
		console.error("Env surface policy check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log("Validated env surface policy.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iterEnvKeys } from "./check_env_example_tracked.ts";
import { isSecretLikeKey } from "./check_env_surface_policy.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const publicAllowedSecretLikeKeys = new Set([
	// Cloudflare Access service-token ids are identifiers used for allowlisting,
	// not token secret material.
	"OPERATOR_CONSOLE_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
]);

export interface WorkerConfigIssue {
	path: string;
	message: string;
}

interface WranglerConfigSurface {
	workerName?: string;
	varTables: { scopeName: string; keys: string[] }[];
	requiredSecretsBySection: Map<string, string[]>;
	parseIssues: string[];
}

export function auditWorkerConfigSurface(root = repoRoot): WorkerConfigIssue[] {
	const issues: WorkerConfigIssue[] = [];
	const wranglerPaths = listWranglerConfigPaths(root);
	for (const wranglerPath of wranglerPaths) {
		issues.push(...auditWranglerVars(wranglerPath, root));
	}

	const appDirs = [...new Set(wranglerPaths.map((path) => dirname(path)))].sort();
	for (const appDir of appDirs) {
		const devVars = join(appDir, ".dev.vars.example");
		if (!existsSync(devVars)) {
			continue;
		}
		const appWranglerPaths = wranglerPaths.filter((path) => dirname(path) === appDir);
		issues.push(...auditDevVars(devVars, appWranglerPaths, root));
	}
	return issues;
}

export function loadRequiredWorkerSecrets({
	wranglerConfigPath,
	envName,
}: {
	wranglerConfigPath: string;
	envName: string | null;
}): [string | undefined, string[]] {
	if (!existsSync(wranglerConfigPath)) {
		throw new Error(`Wrangler config not found: ${wranglerConfigPath}`);
	}
	const config = parseWranglerConfigSurface(wranglerConfigPath);
	const section = envName ? `env.${envName}.secrets` : "secrets";
	return [
		config.workerName,
		normalizeRequiredSecretNames(config.requiredSecretsBySection.get(section)),
	];
}

function auditWranglerVars(path: string, root: string): WorkerConfigIssue[] {
	const relativePath = relativePosix(root, path);
	const config = parseWranglerConfigSurface(path);
	if (config.parseIssues.length > 0) {
		return config.parseIssues.map((message) => ({
			path: relativePath,
			message: `invalid TOML: ${message}`,
		}));
	}

	const issues: WorkerConfigIssue[] = [];
	for (const table of config.varTables) {
		for (const key of table.keys) {
			if (isSecretLikeKey(key) && !publicAllowedSecretLikeKeys.has(key)) {
				issues.push({
					path: relativePath,
					message: `${table.scopeName}.vars contains secret-like key ${key}; use secrets.required`,
				});
			}
		}
	}
	return issues;
}

function auditDevVars(
	devVarsPath: string,
	wranglerPaths: string[],
	root: string,
): WorkerConfigIssue[] {
	const relativePath = relativePosix(root, devVarsPath);
	const required = new Set<string>();
	for (const wranglerPath of wranglerPaths) {
		for (const secret of loadRequiredWorkerSecrets({
			wranglerConfigPath: wranglerPath,
			envName: null,
		})[1]) {
			required.add(secret);
		}
		for (const secret of loadRequiredWorkerSecrets({
			wranglerConfigPath: wranglerPath,
			envName: "local",
		})[1]) {
			required.add(secret);
		}
	}

	const issues: WorkerConfigIssue[] = [];
	for (const [lineNumber, key] of iterEnvKeys(devVarsPath)) {
		if (isSecretLikeKey(key) && !required.has(key) && !publicAllowedSecretLikeKeys.has(key)) {
			issues.push({
				path: relativePath,
				message: `line ${lineNumber}: secret-like key ${key} is not declared in local/root secrets.required`,
			});
		}
	}
	return issues;
}

function parseWranglerConfigSurface(path: string): WranglerConfigSurface {
	let section = "";
	let pendingRequiredSection: string | undefined;
	let pendingRequiredItems: string[] = [];
	const config: WranglerConfigSurface = {
		varTables: [],
		requiredSecretsBySection: new Map(),
		parseIssues: [],
	};
	const varTables = new Map<string, Set<string>>();

	for (const [index, rawLine] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
		const lineNumber = index + 1;
		const line = stripTomlComment(rawLine).trim();
		if (line === "") {
			continue;
		}

		if (pendingRequiredSection) {
			pendingRequiredItems.push(...parseTomlStringItems(line));
			if (line.includes("]")) {
				config.requiredSecretsBySection.set(
					pendingRequiredSection,
					normalizeRequiredSecretNames(pendingRequiredItems),
				);
				pendingRequiredSection = undefined;
				pendingRequiredItems = [];
			}
			continue;
		}

		const sectionMatch = line.match(/^\[\[?([^\]]+)\]\]?$/);
		if (sectionMatch?.[1]) {
			section = sectionMatch[1].trim();
			continue;
		}

		const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
		if (section === "" && nameMatch?.[1]?.trim()) {
			config.workerName = nameMatch[1].trim();
			continue;
		}

		if (isVarsSection(section)) {
			const keyMatch = line.match(/^([A-Za-z0-9_]+)\s*=/);
			if (keyMatch?.[1]) {
				if (!varTables.has(section)) {
					varTables.set(section, new Set());
				}
				varTables.get(section)?.add(keyMatch[1]);
			}
			continue;
		}

		if (isSecretsSection(section)) {
			const requiredMatch = line.match(/^required\s*=\s*(.*)$/);
			if (!requiredMatch) {
				continue;
			}
			const rawValue = requiredMatch[1] ?? "";
			if (!rawValue.includes("[")) {
				config.requiredSecretsBySection.set(section, []);
				continue;
			}
			const items = parseTomlStringItems(rawValue);
			if (rawValue.includes("]")) {
				config.requiredSecretsBySection.set(section, normalizeRequiredSecretNames(items));
			} else {
				pendingRequiredSection = section;
				pendingRequiredItems = items;
			}
			continue;
		}

		if (line.startsWith("[") || line.includes("=")) {
			continue;
		}
		config.parseIssues.push(`line ${lineNumber}: expected assignment or section`);
	}

	if (pendingRequiredSection) {
		config.parseIssues.push(`unterminated required array in [${pendingRequiredSection}]`);
	}

	config.varTables = [...varTables.entries()].map(([scopeName, keys]) => ({
		scopeName: scopeName === "vars" ? "root" : scopeName,
		keys: [...keys].sort(),
	}));
	return config;
}

function listWranglerConfigPaths(root: string): string[] {
	const appsDir = join(root, "apps");
	if (!existsSync(appsDir)) {
		return [];
	}
	const paths: string[] = [];
	for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const appDir = join(appsDir, entry.name);
		for (const child of readdirSync(appDir, { withFileTypes: true })) {
			if (child.isFile() && child.name.startsWith("wrangler") && child.name.endsWith(".toml")) {
				paths.push(join(appDir, child.name));
			}
		}
	}
	return paths.sort();
}

function isVarsSection(section: string): boolean {
	return section === "vars" || /^env\.[^.]+\.vars$/.test(section);
}

function isSecretsSection(section: string): boolean {
	return section === "secrets" || /^env\.[^.]+\.secrets$/.test(section);
}

function parseTomlStringItems(value: string): string[] {
	return [...value.matchAll(/"([^"]+)"/g)]
		.map((match) => match[1])
		.filter((item): item is string => Boolean(item));
}

function normalizeRequiredSecretNames(value: string[] | undefined): string[] {
	return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))].sort();
}

function stripTomlComment(line: string): string {
	let inString = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"' && line[index - 1] !== "\\") {
			inString = !inString;
		}
		if (char === "#" && !inString) {
			return line.slice(0, index);
		}
	}
	return line;
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "worker-config-"));
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
		const wranglerPath = join(root, "apps", "app-api", "wrangler.toml");
		writeText(
			wranglerPath,
			'name = "app-api"\n\n[secrets]\nrequired = ["ROOT_ONLY_SECRET"]\n\n[env.local.secrets]\nrequired = ["LOCAL_SECRET"]\n',
		);
		expectEqualJson(
			loadRequiredWorkerSecrets({ wranglerConfigPath: wranglerPath, envName: null }),
			["app-api", ["ROOT_ONLY_SECRET"]],
			"root required secrets",
		);
		expectEqualJson(
			loadRequiredWorkerSecrets({ wranglerConfigPath: wranglerPath, envName: "local" }),
			["app-api", ["LOCAL_SECRET"]],
			"local required secrets",
		);
	});
	withFixture((root) => {
		writeText(
			join(root, "apps", "campus-web", "wrangler.toml"),
			'name = "campus-web"\n\n[env.local.vars]\nPUBLIC_API_TOKEN = "bad"\n',
		);
		const issues = auditWorkerConfigSurface(root);
		expect(issues.length === 1, "secret-like vars issues count mismatch");
		expectMatch(
			issues[0]?.message ?? "",
			/contains secret-like key PUBLIC_API_TOKEN/,
			"secret-like vars rejection",
		);
	});
	withFixture((root) => {
		writeText(
			join(root, "apps", "campus-web", "wrangler.toml"),
			'name = "campus-web"\n\n[env.local.secrets]\nrequired = ["SENTRY_DSN"]\n',
		);
		writeText(join(root, "apps", "campus-web", ".dev.vars.example"), "SENTRY_DSN=\n");
		expectEqualJson(auditWorkerConfigSurface(root), [], "declared dev vars secret");
	});
	withFixture((root) => {
		writeText(join(root, "apps", "campus-web", "wrangler.toml"), 'name = "campus-web"\n');
		writeText(join(root, "apps", "campus-web", ".dev.vars.example"), "API_KEY=\n");
		const issues = auditWorkerConfigSurface(root);
		expect(issues.length === 1, "undeclared dev vars secret issues count mismatch");
		expectMatch(
			issues[0]?.message ?? "",
			/not declared in local\/root secrets.required/,
			"undeclared dev vars secret rejection",
		);
	});
	console.log("check_worker_config_surface self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditWorkerConfigSurface();
	if (issues.length > 0) {
		console.error("Worker config surface check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated Worker config surface.");
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

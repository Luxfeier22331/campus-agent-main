import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWranglerCommandEnv } from "./run-wrangler-command.ts";

export const defaultAppPaths = ["apps/app-api", "apps/campus-web"];

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const defaultWranglerTimeoutSeconds = 30;
const defaultWranglerMaxAttempts = 3;
const wranglerAuthErrorMarkers = [
	"failed to fetch auth token",
	"not logged in",
	"cloudflare_api_token",
];
const wranglerConfigRelativePaths = [
	".config/.wrangler/config/default.toml",
	".wrangler/config/default.toml",
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../..");

export interface WorkerSecretAppStatus {
	app_path: string;
	audit_command: string | null;
	configured_secrets: string[];
	error: string | null;
	missing_secrets: string[];
	ready: boolean;
	recommended_delete_commands: string[];
	recommended_put_commands: string[];
	required_secrets: string[];
	unexpected_secrets: string[];
	worker_name: string | null;
	wrangler_config_path: string;
}

export interface WorkerSecretPresenceStatus {
	apps: Record<string, WorkerSecretAppStatus>;
	env: string | null;
	overall_ready: boolean;
}

interface RunCommandOptions {
	captureOutput: true;
	env: Record<string, string>;
	text: true;
	timeout: number;
}

interface RunCommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

type RunCommand = (command: string[], options: RunCommandOptions) => RunCommandResult;

export class CommandTimeoutError extends Error {
	readonly command: string[];
	readonly timeoutSeconds: number;

	constructor(command: string[], timeoutSeconds: number) {
		super(`command timed out after ${timeoutSeconds}s`);
		this.command = command;
		this.timeoutSeconds = timeoutSeconds;
	}
}

function defaultRunCommand(command: string[], options: RunCommandOptions): RunCommandResult {
	const result = spawnSync(command[0] ?? "", command.slice(1), {
		env: options.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: options.timeout * 1000,
	});
	if (result.error) {
		if (isTimeoutError(result.error)) {
			throw new CommandTimeoutError(command, options.timeout);
		}
		throw result.error;
	}
	return {
		status: typeof result.status === "number" ? result.status : 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export function loadRequiredWorkerSecrets({
	wranglerConfigPath,
	envName,
}: {
	wranglerConfigPath: string;
	envName: string | null;
}): { requiredSecrets: string[]; workerName: string | null } {
	if (!existsSync(wranglerConfigPath)) {
		throw new Error(`Wrangler config not found: ${wranglerConfigPath}`);
	}
	const parsed = parseWranglerSecretConfig(readFileSync(wranglerConfigPath, "utf8"));
	const targetSection = envName ? `env.${envName}.secrets` : "secrets";
	return {
		requiredSecrets: parsed.requiredBySection[targetSection] ?? [],
		workerName: parsed.workerName,
	};
}

export function buildCloudflareCliEnv(
	baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const sourceEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(buildWranglerCommandEnv(baseEnv))) {
		if (value !== undefined) {
			sourceEnv[key] = value;
		}
	}
	return sourceEnv;
}

export function buildSecretListCommand({
	root,
	appPath,
	envName,
}: {
	root: string;
	appPath: string;
	envName: string | null;
}): string[] {
	const command = [
		"pnpm",
		"exec",
		"tsx",
		join(root, "scripts", "deploy", "run-wrangler-command.ts"),
		"--cwd",
		join(root, appPath),
		"versions",
		"list",
	];
	if (envName) {
		command.push("--env", envName);
	}
	command.push("--json");
	return command;
}

export function buildSecretViewCommand({
	root,
	appPath,
	versionId,
	envName,
}: {
	root: string;
	appPath: string;
	versionId: string;
	envName: string | null;
}): string[] {
	const command = [
		"pnpm",
		"exec",
		"tsx",
		join(root, "scripts", "deploy", "run-wrangler-command.ts"),
		"--cwd",
		join(root, appPath),
		"versions",
		"view",
		versionId,
	];
	if (envName) {
		command.push("--env", envName);
	}
	command.push("--json");
	return command;
}

export function buildSecretPutCommand({
	root,
	appPath,
	secretName,
	envName,
}: {
	root: string;
	appPath: string;
	secretName: string;
	envName: string | null;
}): string[] {
	const command = [
		"pnpm",
		"exec",
		"tsx",
		join(root, "scripts", "deploy", "run-wrangler-command.ts"),
		"--cwd",
		join(root, appPath),
		"versions",
		"secret",
		"put",
		secretName,
	];
	if (envName) {
		command.push("--env", envName);
	}
	return command;
}

export function buildSecretDeleteCommand({
	root,
	appPath,
	secretName,
	envName,
}: {
	root: string;
	appPath: string;
	secretName: string;
	envName: string | null;
}): string[] {
	const command = [
		"pnpm",
		"exec",
		"tsx",
		join(root, "scripts", "deploy", "run-wrangler-command.ts"),
		"--cwd",
		join(root, appPath),
		"versions",
		"secret",
		"delete",
		secretName,
	];
	if (envName) {
		command.push("--env", envName);
	}
	return command;
}

export function listConfiguredWorkerSecrets({
	root,
	appPath,
	envName,
	runCommand = defaultRunCommand,
}: {
	root: string;
	appPath: string;
	envName: string | null;
	runCommand?: RunCommand;
}): { auditCommand: string; configuredSecrets: string[] } {
	const listCommand = buildSecretListCommand({ root, appPath, envName });
	const versions = runWranglerJsonCommand({
		appPath,
		command: listCommand,
		operation: "versions list",
		runCommand,
	});
	if (!Array.isArray(versions)) {
		throw new Error(`Unexpected wrangler versions list payload for ${appPath}: expected list`);
	}
	const latestVersion = versions
		.filter(
			(item): item is Record<string, unknown> =>
				isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0,
		)
		.toSorted((left, right) => versionOrder(right) - versionOrder(left))[0];
	if (!latestVersion || typeof latestVersion.id !== "string") {
		throw new Error(`Wrangler returned no Worker versions for ${appPath}`);
	}

	const viewCommand = buildSecretViewCommand({
		root,
		appPath,
		versionId: latestVersion.id,
		envName,
	});
	const version = runWranglerJsonCommand({
		appPath,
		command: viewCommand,
		operation: "versions view",
		runCommand,
	});
	const bindings =
		isRecord(version) && isRecord(version.resources) ? version.resources.bindings : null;
	if (!Array.isArray(bindings)) {
		throw new Error(`Unexpected wrangler versions view payload for ${appPath}: missing bindings`);
	}
	const configuredSecrets = [
		...new Set(
			bindings
				.map((item) =>
					isRecord(item) && item.type === "secret_text" && typeof item.name === "string"
						? item.name.trim()
						: "",
				)
				.filter(Boolean),
		),
	].sort();
	return {
		auditCommand: `${shellJoin(listCommand)} && ${shellJoin(viewCommand)}`,
		configuredSecrets,
	};
}

function runWranglerJsonCommand({
	appPath,
	command,
	operation,
	runCommand,
}: {
	appPath: string;
	command: string[];
	operation: string;
	runCommand: RunCommand;
}): unknown {
	const timeoutSeconds = readPositiveIntEnv(
		"WORKER_SECRET_AUDIT_TIMEOUT_SECONDS",
		defaultWranglerTimeoutSeconds,
	);
	const maxAttempts = readPositiveIntEnv(
		"WORKER_SECRET_AUDIT_MAX_ATTEMPTS",
		defaultWranglerMaxAttempts,
	);

	let result: RunCommandResult | null = null;
	let lastTimeout: CommandTimeoutError | null = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			result = runCommand(command, {
				captureOutput: true,
				env: buildCloudflareCliEnv(),
				text: true,
				timeout: timeoutSeconds,
			});
			break;
		} catch (error) {
			if (!isCommandTimeout(error)) {
				throw error;
			}
			lastTimeout = error;
			if (attempt === maxAttempts) {
				const attemptDetail = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : "";
				throw new Error(
					`wrangler ${operation} timed out for ${appPath} after ${timeoutSeconds}s${attemptDetail}`,
				);
			}
		}
	}
	if (!result) {
		if (lastTimeout) {
			throw new Error(`wrangler ${operation} timed out for ${appPath} after ${timeoutSeconds}s`);
		}
		throw new Error(`wrangler ${operation} failed to start for ${appPath}`);
	}

	if (result.status !== 0) {
		const parts: string[] = [];
		const stdout = sanitizeCliOutput(result.stdout);
		const stderr = sanitizeCliOutput(result.stderr);
		if (stdout) {
			parts.push(stdout);
		}
		if (stderr) {
			parts.push(stderr);
		}
		const guidance = buildWranglerAuthFailureGuidance({ appPath, stdout, stderr });
		if (guidance) {
			parts.push(guidance);
		}
		throw new Error(
			`wrangler ${operation} failed for ${appPath}: ${
				parts.length > 0 ? parts.join(" | ") : `exit_code=${result.status ?? 1}`
			}`,
		);
	}

	try {
		return JSON.parse(result.stdout || "null") as unknown;
	} catch (error) {
		throw new Error(
			`Invalid JSON from wrangler ${operation} for ${appPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

function versionOrder(version: Record<string, unknown>): number {
	if (typeof version.number === "number" && Number.isFinite(version.number)) {
		return version.number;
	}
	const metadata = isRecord(version.metadata) ? version.metadata : null;
	const createdOn = metadata && typeof metadata.created_on === "string" ? metadata.created_on : "";
	const timestamp = Date.parse(createdOn);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function collectWorkerSecretPresence({
	root,
	envName,
	appPaths = defaultAppPaths,
	runCommand = defaultRunCommand,
}: {
	root: string;
	envName: string | null;
	appPaths?: string[];
	runCommand?: RunCommand;
}): WorkerSecretPresenceStatus {
	const apps: Record<string, WorkerSecretAppStatus> = {};

	for (const appPath of appPaths) {
		const wranglerConfigPath = join(root, appPath, "wrangler.toml");
		const appStatus: WorkerSecretAppStatus = {
			app_path: appPath,
			audit_command: null,
			configured_secrets: [],
			error: null,
			missing_secrets: [],
			ready: false,
			recommended_delete_commands: [],
			recommended_put_commands: [],
			required_secrets: [],
			unexpected_secrets: [],
			worker_name: null,
			wrangler_config_path: wranglerConfigPath,
		};

		try {
			const { requiredSecrets, workerName } = loadRequiredWorkerSecrets({
				wranglerConfigPath,
				envName,
			});
			appStatus.worker_name = workerName;
			appStatus.required_secrets = requiredSecrets;
			appStatus.audit_command = shellJoin(buildSecretListCommand({ root, appPath, envName }));

			const { auditCommand, configuredSecrets } = listConfiguredWorkerSecrets({
				root,
				appPath,
				envName,
				runCommand,
			});
			const missingSecrets = requiredSecrets.filter(
				(secretName) => !configuredSecrets.includes(secretName),
			);
			const unexpectedSecrets = configuredSecrets.filter(
				(secretName) => !requiredSecrets.includes(secretName),
			);
			appStatus.audit_command = auditCommand;
			appStatus.configured_secrets = configuredSecrets;
			appStatus.missing_secrets = missingSecrets;
			appStatus.unexpected_secrets = unexpectedSecrets;
			appStatus.recommended_delete_commands = unexpectedSecrets.map((secretName) =>
				shellJoin(buildSecretDeleteCommand({ root, appPath, secretName, envName })),
			);
			appStatus.recommended_put_commands = missingSecrets.map((secretName) =>
				shellJoin(buildSecretPutCommand({ root, appPath, secretName, envName })),
			);
			appStatus.ready = missingSecrets.length === 0 && unexpectedSecrets.length === 0;
		} catch (error) {
			appStatus.error = error instanceof Error ? error.message : String(error);
		}

		apps[appPath] = appStatus;
	}

	return {
		apps,
		env: envName,
		overall_ready: Object.values(apps).every((app) => app.ready),
	};
}

function parseWranglerSecretConfig(content: string): {
	requiredBySection: Record<string, string[]>;
	workerName: string | null;
} {
	const lines = content.split(/\r?\n/);
	let section = "";
	let workerName: string | null = null;
	const requiredBySection: Record<string, string[]> = {};

	for (let index = 0; index < lines.length; index += 1) {
		const line = stripTomlComment(lines[index] ?? "").trim();
		if (!line) {
			continue;
		}
		const sectionMatch = /^\[([^\]]+)]$/.exec(line);
		if (sectionMatch) {
			section = sectionMatch[1]?.trim() ?? "";
			continue;
		}
		if (!section && line.startsWith("name")) {
			const value = parseAssignmentString(line, "name");
			if (value?.trim()) {
				workerName = value.trim();
			}
			continue;
		}
		if (!line.startsWith("required")) {
			continue;
		}
		const parsed = parseRequiredAssignment(lines, index);
		if (parsed) {
			requiredBySection[section] = normalizeRequiredSecretNames(parsed.values);
			index = parsed.endIndex;
		}
	}

	return { requiredBySection, workerName };
}

function parseRequiredAssignment(
	lines: string[],
	startIndex: number,
): { endIndex: number; values: string[] } | null {
	const firstLine = lines[startIndex] ?? "";
	const assignmentIndex = firstLine.indexOf("=");
	if (assignmentIndex < 0 || firstLine.slice(0, assignmentIndex).trim() !== "required") {
		return null;
	}

	let arrayText = firstLine.slice(assignmentIndex + 1);
	let endIndex = startIndex;
	while (!arrayText.includes("]") && endIndex + 1 < lines.length) {
		endIndex += 1;
		arrayText = `${arrayText}\n${lines[endIndex] ?? ""}`;
	}
	if (!arrayText.includes("[")) {
		return { endIndex, values: [] };
	}
	return { endIndex, values: parseTomlStringArray(arrayText) };
}

function parseTomlStringArray(value: string): string[] {
	const values: string[] = [];
	const stringPattern = /"((?:\\.|[^"\\])*)"/g;
	for (const match of value.matchAll(stringPattern)) {
		const raw = match[0];
		try {
			values.push(JSON.parse(raw) as string);
		} catch {
			values.push(match[1] ?? "");
		}
	}
	return values;
}

function parseAssignmentString(line: string, key: string): string | null {
	const assignmentPattern = new RegExp(
		`^${escapeRegExp(key)}\\s*=\\s*("((?:\\\\.|[^"\\\\])*)"|'([^']*)')`,
	);
	const match = assignmentPattern.exec(line);
	if (!match) {
		return null;
	}
	if (match[2] !== undefined) {
		try {
			return JSON.parse(match[1] ?? '""') as string;
		} catch {
			return match[2];
		}
	}
	return match[3] ?? null;
}

function normalizeRequiredSecretNames(rawValues: unknown[]): string[] {
	return [...new Set(rawValues.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function stripTomlComment(line: string): string {
	let inString = false;
	let quote = "";
	let escaped = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if ((char === '"' || char === "'") && (!inString || char === quote)) {
			inString = !inString;
			quote = inString ? char : "";
			continue;
		}
		if (char === "#" && !inString) {
			return line.slice(0, index);
		}
	}
	return line;
}

function sanitizeCliOutput(value: string): string {
	return ansiEscapePattern[Symbol.replace](value, "")
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function readPositiveIntEnv(name: string, defaultValue: number): number {
	const rawValue = String(process.env[name] ?? defaultValue).trim();
	const parsed = Number.parseInt(rawValue, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function buildWranglerAuthFailureGuidance({
	appPath,
	stdout,
	stderr,
}: {
	appPath: string;
	stdout: string;
	stderr: string;
}): string | null {
	const combinedOutput = `${stdout}\n${stderr}`.toLowerCase();
	if (!wranglerAuthErrorMarkers.some((marker) => combinedOutput.includes(marker))) {
		return null;
	}

	const guidanceParts: string[] = [];
	const metadata = loadLocalWranglerOauthMetadata();
	if (!metadata) {
		guidanceParts.push("No local Wrangler OAuth config was found.");
	} else if (metadata.parseError) {
		guidanceParts.push(`Local Wrangler OAuth config at ${metadata.path} could not be parsed.`);
	} else if (metadata.expirationTime) {
		const expiration = parseIsoTimestamp(metadata.expirationTime);
		if (expiration && expiration.getTime() <= Date.now()) {
			guidanceParts.push(
				`Local Wrangler OAuth at ${metadata.path} expired at ${metadata.expirationTime}.`,
			);
		} else {
			guidanceParts.push(
				`Local Wrangler OAuth metadata was found at ${metadata.path} and currently expires at ${metadata.expirationTime}.`,
			);
		}
	} else if (metadata.hasOauthToken) {
		guidanceParts.push(
			`Local Wrangler OAuth metadata was found at ${metadata.path}, but the current auth refresh failed.`,
		);
	} else {
		guidanceParts.push(
			`Local Wrangler OAuth config exists at ${metadata.path}, but it does not contain a usable access token.`,
		);
	}

	guidanceParts.push(
		`Run \`pnpm --dir ${appPath} exec wrangler login\` to refresh the local OAuth session, or export \`CLOUDFLARE_AUTOMATION_TOKEN\` for non-interactive staging preflight.`,
	);
	return guidanceParts.join(" ");
}

function loadLocalWranglerOauthMetadata(): {
	expirationTime: string | null;
	hasOauthToken: boolean;
	hasRefreshToken: boolean;
	parseError: boolean;
	path: string;
} | null {
	const homeDir = process.env.HOME;
	if (!homeDir) {
		return null;
	}

	for (const relativePath of wranglerConfigRelativePaths) {
		const configPath = join(homeDir, relativePath);
		if (!existsSync(configPath)) {
			continue;
		}
		try {
			const content = readFileSync(configPath, "utf8");
			return {
				expirationTime: parseAssignmentStringFromContent(content, "expiration_time"),
				hasOauthToken: Boolean(parseAssignmentStringFromContent(content, "oauth_token")?.trim()),
				hasRefreshToken: Boolean(
					parseAssignmentStringFromContent(content, "refresh_token")?.trim(),
				),
				parseError: false,
				path: configPath,
			};
		} catch {
			return {
				expirationTime: null,
				hasOauthToken: false,
				hasRefreshToken: false,
				parseError: true,
				path: configPath,
			};
		}
	}
	return null;
}

function parseAssignmentStringFromContent(content: string, key: string): string | null {
	for (const rawLine of content.split(/\r?\n/)) {
		const value = parseAssignmentString(stripTomlComment(rawLine).trim(), key);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function parseIsoTimestamp(value: string): Date | null {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shellJoin(command: string[]): string {
	return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
		return value;
	}
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: Error): boolean {
	const withCode = error as Error & { code?: string };
	return withCode.code === "ETIMEDOUT" || /timed?\s*out|ETIMEDOUT/i.test(error.message);
}

function isCommandTimeout(error: unknown): error is CommandTimeoutError {
	return error instanceof CommandTimeoutError;
}

function printTextReport(status: WorkerSecretPresenceStatus): void {
	console.log(`env=${status.env ?? ""}`);
	console.log(`overall_ready=${status.overall_ready}`);
	for (const [appPath, appStatus] of Object.entries(status.apps)) {
		console.log(`${appPath}: ready=${appStatus.ready}`);
		if (appStatus.worker_name) {
			console.log(`${appPath}: worker_name=${appStatus.worker_name}`);
		}
		if (appStatus.audit_command) {
			console.log(`${appPath}: audit_command=${appStatus.audit_command}`);
		}
		if (appStatus.required_secrets.length > 0) {
			console.log(`${appPath}: required_secrets=${appStatus.required_secrets.join(",")}`);
		}
		if (appStatus.configured_secrets.length > 0) {
			console.log(`${appPath}: configured_secrets=${appStatus.configured_secrets.join(",")}`);
		}
		if (appStatus.missing_secrets.length > 0) {
			console.log(`${appPath}: missing_secrets=${appStatus.missing_secrets.join(",")}`);
		}
		if (appStatus.unexpected_secrets.length > 0) {
			console.log(`${appPath}: unexpected_secrets=${appStatus.unexpected_secrets.join(",")}`);
		}
		for (const command of appStatus.recommended_put_commands) {
			console.log(`${appPath}: recommended_put_command=${command}`);
		}
		for (const command of appStatus.recommended_delete_commands) {
			console.log(`${appPath}: recommended_delete_command=${command}`);
		}
		if (appStatus.error) {
			console.log(`${appPath}: error=${appStatus.error}`);
		}
	}
}

function parseArgs(argv: string[]): {
	appPaths: string[] | null;
	envName: string | null;
	json: boolean;
	root: string;
	selfTest: boolean;
} {
	let root = repoRoot;
	let envName: string | null = "staging";
	const appPaths: string[] = [];
	let json = false;
	let selfTest = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--repo-root" || arg === "--env" || arg === "--app") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error(`${arg} requires a value`);
			}
			if (arg === "--repo-root") {
				root = value;
			} else if (arg === "--env") {
				envName = value.trim() || null;
			} else {
				appPaths.push(value);
			}
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}

	return { appPaths: appPaths.length > 0 ? appPaths : null, envName, json, root, selfTest };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const args = parseArgs(argv);
	if (args.selfTest) {
		const { runWorkerSecretPresenceSelfTest } = await import(
			"./check-worker-secret-presence.self-test.ts"
		);
		return runWorkerSecretPresenceSelfTest();
	}
	const status = collectWorkerSecretPresence({
		root: resolve(args.root),
		envName: args.envName,
		appPaths: args.appPaths ?? defaultAppPaths,
	});
	if (args.json) {
		console.log(JSON.stringify(status, null, 2));
	} else {
		printTextReport(status);
	}
	return status.overall_ready ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}

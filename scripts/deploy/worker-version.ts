import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWranglerCommand } from "./run-wrangler-command.ts";
import { resolveGitSha } from "./staging-release.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface WorkerVersionSummary {
	id: string;
	metadata?: {
		created_on?: string;
	};
	annotations?: Record<string, string>;
}

interface WorkerDeploymentSummary {
	id: string;
}

interface WorkerVersionDetails {
	resources?: {
		bindings?: unknown[];
	};
}

export interface UploadedWorkerVersion {
	buildIdentity?: string;
	workerName: string;
	versionId: string;
	sourceSha: string;
	[key: string]: string | undefined;
}

interface SentrySourceMapUploadOptions {
	artifactDirectory: string;
	orgSlug: string;
	projectSlug: string;
	release: string;
	wranglerOutdir?: string;
}

interface WorkerVersionUploadOptions {
	appName: string;
	buildIdentity?: string;
	config?: string;
	environment?: string;
	secretsFile?: string;
	sentrySourceMaps?: SentrySourceMapUploadOptions;
	variables: Record<string, string>;
}

function fail(message: string): never {
	throw new Error(message);
}

function parseJsonOutput<T>(stdout: string | Buffer | null, command: string): T {
	const text = String(stdout ?? "").trim();
	try {
		return JSON.parse(text) as T;
	} catch {
		return fail(`${command} did not return valid JSON.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveWorkerPlainTextVariable(payload: unknown, variableName: string): string {
	const bindings = isRecord(payload)
		? (payload as WorkerVersionDetails).resources?.bindings
		: undefined;
	if (!Array.isArray(bindings)) {
		return fail("Worker version details do not contain resource bindings.");
	}
	const matches = bindings.filter(
		(binding): binding is Record<string, unknown> =>
			isRecord(binding) && binding.type === "plain_text" && binding.name === variableName,
	);
	const binding = matches[0];
	if (matches.length !== 1 || typeof binding?.text !== "string") {
		return fail(`Worker version must contain exactly one plain-text ${variableName} binding.`);
	}
	return binding.text;
}

export function readWorkerVersionPlainTextVariable(options: {
	cwd: string;
	variableName: string;
	versionId: string;
	workerName: string;
}): string {
	const result = runWranglerCommand(
		["versions", "view", options.versionId, "--name", options.workerName, "--json"],
		{ cwd: options.cwd, stdio: "pipe" },
	);
	if (result.status !== 0) {
		return fail(`Unable to read Worker version ${options.versionId} for ${options.workerName}.`);
	}
	return resolveWorkerPlainTextVariable(
		parseJsonOutput<unknown>(result.stdout, "wrangler versions view"),
		options.variableName,
	);
}

function readCurrentDeploymentId(cwd: string, workerName: string): string {
	const result = runWranglerCommand(["deployments", "status", "--name", workerName, "--json"], {
		cwd,
		stdio: "pipe",
	});
	if (result.status !== 0) {
		return fail(`Unable to read the current deployment for ${workerName}.`);
	}
	return parseJsonOutput<WorkerDeploymentSummary>(result.stdout, "wrangler deployments status").id;
}

export function selectUploadedVersion(
	versions: WorkerVersionSummary[],
	tag: string,
): WorkerVersionSummary {
	const matches = versions
		.filter((version) => version.annotations?.["workers/tag"] === tag)
		.sort((left, right) =>
			String(right.metadata?.created_on ?? "").localeCompare(
				String(left.metadata?.created_on ?? ""),
			),
		);
	if (matches.length === 0) {
		return fail(`No uploaded Worker version has tag ${tag}.`);
	}
	return matches[0];
}

export function buildWorkerVersionUploadArgs(
	options: WorkerVersionUploadOptions,
	sourceSha: string,
): string[] {
	const args = ["versions", "upload"];
	if (options.config) {
		args.push("--config", options.config);
	}
	if (options.environment) {
		args.push("--env", options.environment);
	}
	if (options.secretsFile) {
		args.push("--secrets-file", options.secretsFile);
	}
	if (options.sentrySourceMaps) {
		args.push("--upload-source-maps");
		if (options.sentrySourceMaps.wranglerOutdir) {
			if (!isAbsolute(options.sentrySourceMaps.wranglerOutdir)) {
				fail("Wrangler source-map output directory must be absolute.");
			}
			args.push("--outdir", options.sentrySourceMaps.wranglerOutdir);
		}
	}
	args.push(
		"--tag",
		resolveWorkerVersionTag(options.buildIdentity, sourceSha),
		"--message",
		`MUC-WIKI/campus-agent@${sourceSha} (${options.appName})`,
	);
	for (const [name, value] of Object.entries(options.variables).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		args.push("--var", `${name}:${value}`);
	}
	return args;
}

export function buildSentrySourceMapUploadArgs(options: {
	artifactDirectory: string;
	orgSlug: string;
	projectSlug: string;
	release: string;
}): string[] {
	return [
		"sourcemaps",
		"upload",
		"--org",
		options.orgSlug,
		"--project",
		options.projectSlug,
		"--release",
		options.release,
		"--strip-common-prefix",
		"--strict",
		"--validate",
		"--wait-for",
		"60",
		options.artifactDirectory,
	];
}

function uploadSentrySourceMaps(
	cwd: string,
	workerName: string,
	options: SentrySourceMapUploadOptions,
): void {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: this direct release command is not a Turbo task.
	const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
	if (!authToken) {
		fail(`SENTRY_AUTH_TOKEN is required to upload source maps for ${workerName}.`);
	}

	const sentryEnv = { ...process.env };
	delete sentryEnv.SENTRY_ALLOW_FAILURE;
	delete sentryEnv.SENTRY_ORG;
	delete sentryEnv.SENTRY_PROJECT;
	sentryEnv.SENTRY_AUTH_TOKEN = authToken;
	sentryEnv.SENTRY_DISABLE_UPDATE_CHECK = "true";
	sentryEnv.SENTRY_LOAD_DOTENV = "0";
	sentryEnv.SENTRY_NO_PROGRESS_BAR = "1";
	sentryEnv.SENTRY_URL = "https://sentry.io/";

	const artifactDirectory = resolve(cwd, options.artifactDirectory);
	const result = spawnSync(
		"pnpm",
		["exec", "sentry-cli", ...buildSentrySourceMapUploadArgs({ ...options, artifactDirectory })],
		{
			cwd: repoRoot,
			env: sentryEnv,
			stdio: "inherit",
		},
	);
	if (result.status !== 0) {
		fail(`Unable to upload Sentry source maps for ${workerName}.`);
	}
}

export function uploadStagingWorkerVersion(options: {
	appName: string;
	buildIdentity?: string;
	candidateMetadata?: Record<string, string>;
	config?: string;
	cwd: string;
	environment?: string;
	secretsFile?: string;
	sentrySourceMaps?: SentrySourceMapUploadOptions;
	variables: Record<string, string>;
	workerName: string;
}): UploadedWorkerVersion {
	const sourceSha = resolveGitSha();
	const tag = resolveWorkerVersionTag(options.buildIdentity, sourceSha);
	if (
		options.sentrySourceMaps &&
		options.variables.DEPLOYMENT_RELEASE !== options.sentrySourceMaps.release
	) {
		return fail(
			`Sentry source-map release for ${options.workerName} must match the Worker DEPLOYMENT_RELEASE variable.`,
		);
	}
	const deploymentBefore = readCurrentDeploymentId(options.cwd, options.workerName);
	const args = buildWorkerVersionUploadArgs(options, sourceSha);

	const upload = runWranglerCommand(args, { cwd: options.cwd, stdio: "inherit" });
	if (upload.status !== 0) {
		return fail(`Unable to upload a Worker version for ${options.workerName}.`);
	}

	const list = runWranglerCommand(["versions", "list", "--name", options.workerName, "--json"], {
		cwd: options.cwd,
		stdio: "pipe",
	});
	if (list.status !== 0) {
		return fail(`Unable to resolve the uploaded version for ${options.workerName}.`);
	}
	const version = selectUploadedVersion(
		parseJsonOutput<WorkerVersionSummary[]>(list.stdout, "wrangler versions list"),
		tag,
	);
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(version.id)) {
		return fail(`Uploaded Worker version for ${options.workerName} has an invalid id.`);
	}

	const deploymentAfter = readCurrentDeploymentId(options.cwd, options.workerName);
	if (deploymentAfter !== deploymentBefore) {
		return fail(
			`Uploading ${options.workerName} changed deployment ${deploymentBefore} to ${deploymentAfter}.`,
		);
	}
	if (options.sentrySourceMaps) {
		uploadSentrySourceMaps(options.cwd, options.workerName, options.sentrySourceMaps);
	}

	const result = {
		...(options.buildIdentity ? { buildIdentity: options.buildIdentity } : {}),
		...validateCandidateMetadata(options.candidateMetadata),
		workerName: options.workerName,
		versionId: version.id,
		sourceSha,
	};
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: this direct release command is not a Turbo task.
	const outputPath = process.env.WORKER_VERSION_OUTPUT?.trim();
	if (outputPath) {
		writeFileSync(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
	}
	return result;
}

function resolveWorkerVersionTag(buildIdentity: string | undefined, sourceSha: string): string {
	if (!buildIdentity) {
		return `git-${sourceSha}`;
	}
	if (!/^sha256:[a-f0-9]{64}$/u.test(buildIdentity)) {
		return fail("Worker build identity must be sha256:<64 lowercase hex characters>.");
	}
	return `build-${buildIdentity.slice("sha256:".length)}`;
}

function validateCandidateMetadata(
	value: Record<string, string> | undefined,
): Record<string, string> {
	const metadata = value ?? {};
	for (const key of ["workerName", "versionId", "sourceSha", "buildIdentity"]) {
		if (key in metadata) {
			return fail(`Worker candidate metadata cannot override ${key}.`);
		}
	}
	return metadata;
}

function main(argv: string[]): number {
	if (argv.length !== 5 || argv[0] !== "read-variable") {
		console.error(
			"Usage: worker-version.ts read-variable <app-dir> <worker-name> <version-id> <variable-name>",
		);
		return 1;
	}
	const [, cwd, workerName, versionId, variableName] = argv;
	console.log(readWorkerVersionPlainTextVariable({ cwd, variableName, versionId, workerName }));
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatWranglerFailure, runWranglerCommand } from "./run-wrangler-command.ts";
import { resolveGitSha } from "./staging-release.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface WorkerVersionSummary {
	id: string;
	metadata?: {
		created_on?: string;
	};
	annotations?: Record<string, string>;
}

interface WorkerVersionDetails extends WorkerVersionSummary {
	resources?: {
		bindings?: unknown[];
	};
}

const WORKER_NOT_FOUND_ERROR_CODES = new Set([10007, 10090]);

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

interface ExpectedWorkerBinding {
	name: string;
	properties: Record<string, string>;
	type: string;
}

interface WorkerVersionUploadOptions {
	appName: string;
	buildIdentity?: string;
	config?: string;
	environment?: string;
	expectedBindings?: ExpectedWorkerBinding[];
	secretsFile?: string;
	sentrySourceMaps?: SentrySourceMapUploadOptions;
	variables: Record<string, string>;
}

interface StagingWorkerVersionOptions extends WorkerVersionUploadOptions {
	candidateMetadata?: Record<string, string>;
	cwd: string;
	workerName: string;
}

type WranglerRunner = typeof runWranglerCommand;

interface WorkerVersionUploadDependencies {
	env?: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
	resolveSourceSha?: () => string;
	runWrangler?: WranglerRunner;
	uploadSourceMaps?: typeof uploadSentrySourceMaps;
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

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		return fail(`${name} is required to inspect Worker versions.`);
	}
	return value;
}

async function cloudflareApiResult(
	path: string,
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch,
	workerName: string,
): Promise<unknown> {
	const token = requiredEnvironment(env, "CLOUDFLARE_API_TOKEN");
	let response: Response;
	try {
		response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch (error) {
		throw new Error("Cloudflare API request for Worker versions failed.", { cause: error });
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new Error("Cloudflare API returned invalid JSON for Worker versions.", {
			cause: error,
		});
	}
	if (!isRecord(payload)) {
		return fail("Cloudflare API returned an invalid response for Worker versions.");
	}
	if (!response.ok || payload.success !== true || payload.result === undefined) {
		const workerNotFound =
			Array.isArray(payload.errors) &&
			payload.errors.some(
				(error) =>
					isRecord(error) &&
					typeof error.code === "number" &&
					WORKER_NOT_FOUND_ERROR_CODES.has(error.code),
			);
		if (workerNotFound) {
			return fail(
				`Worker ${workerName} does not exist. Provision its first deployment through the environment-owned Cloudflare workflow before publishing candidate versions.`,
			);
		}
		return fail(`Cloudflare API request for Worker versions failed with HTTP ${response.status}.`);
	}
	return payload.result;
}

function validWorkerVersionId(id: unknown, workerName: string): string {
	if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id)) {
		return fail(`Worker version for ${workerName} has an invalid id.`);
	}
	return id;
}

async function listDeployableWorkerVersions(options: {
	accountId: string;
	env: NodeJS.ProcessEnv;
	fetcher: typeof fetch;
	workerName: string;
}): Promise<WorkerVersionSummary[]> {
	const result = await cloudflareApiResult(
		`/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.workerName)}/versions?deployable=true`,
		options.env,
		options.fetcher,
		options.workerName,
	);
	if (!(isRecord(result) && Array.isArray(result.items))) {
		return fail(`Cloudflare API did not return deployable versions for ${options.workerName}.`);
	}
	return result.items.map((item) => {
		if (!isRecord(item)) {
			return fail(`Cloudflare API returned an invalid version for ${options.workerName}.`);
		}
		const id = validWorkerVersionId(item.id, options.workerName);
		const metadata = isRecord(item.metadata)
			? {
					created_on:
						typeof item.metadata.created_on === "string" ? item.metadata.created_on : undefined,
				}
			: undefined;
		const annotations = isRecord(item.annotations)
			? Object.fromEntries(
					Object.entries(item.annotations).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				)
			: undefined;
		return {
			...(annotations ? { annotations } : {}),
			id,
			...(metadata?.created_on ? { metadata: { created_on: metadata.created_on } } : {}),
		};
	});
}

async function readWorkerVersionDetails(options: {
	accountId: string;
	env: NodeJS.ProcessEnv;
	fetcher: typeof fetch;
	versionId: string;
	workerName: string;
}): Promise<WorkerVersionDetails> {
	const result = await cloudflareApiResult(
		`/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.workerName)}/versions/${encodeURIComponent(options.versionId)}`,
		options.env,
		options.fetcher,
		options.workerName,
	);
	if (!isRecord(result)) {
		return fail(`Cloudflare API returned invalid version details for ${options.workerName}.`);
	}
	const id = validWorkerVersionId(result.id, options.workerName);
	if (id !== options.versionId) {
		return fail(`Cloudflare API returned the wrong version details for ${options.workerName}.`);
	}
	return result as unknown as WorkerVersionDetails;
}

function workerVersionMatches(
	details: WorkerVersionDetails,
	expected: {
		bindings: ExpectedWorkerBinding[];
		message: string;
		tag: string;
		variables: Record<string, string>;
	},
): boolean {
	if (
		details.annotations?.["workers/tag"] !== expected.tag ||
		details.annotations?.["workers/message"] !== expected.message
	) {
		return false;
	}
	const bindings = details.resources?.bindings;
	if (!Array.isArray(bindings)) {
		return false;
	}
	for (const [name, value] of Object.entries(expected.variables)) {
		const matches = bindings.filter(
			(binding): binding is Record<string, unknown> =>
				isRecord(binding) && binding.type === "plain_text" && binding.name === name,
		);
		if (matches.length !== 1 || matches[0]?.text !== value) {
			return false;
		}
	}
	for (const expectedBinding of expected.bindings) {
		const matches = bindings.filter(
			(binding): binding is Record<string, unknown> =>
				isRecord(binding) &&
				binding.type === expectedBinding.type &&
				binding.name === expectedBinding.name,
		);
		if (
			matches.length !== 1 ||
			Object.entries(expectedBinding.properties).some(
				([name, value]) => matches[0]?.[name] !== value,
			)
		) {
			return false;
		}
	}
	return true;
}

async function findReusableWorkerVersion(options: {
	accountId: string;
	bindings: ExpectedWorkerBinding[];
	env: NodeJS.ProcessEnv;
	excludeVersionIds?: ReadonlySet<string>;
	fetcher: typeof fetch;
	message: string;
	tag: string;
	variables: Record<string, string>;
	workerName: string;
}): Promise<WorkerVersionSummary | undefined> {
	const versions = (
		await listDeployableWorkerVersions({
			accountId: options.accountId,
			env: options.env,
			fetcher: options.fetcher,
			workerName: options.workerName,
		})
	).sort((left, right) =>
		String(right.metadata?.created_on ?? "").localeCompare(String(left.metadata?.created_on ?? "")),
	);
	for (const version of versions) {
		if (options.excludeVersionIds?.has(version.id)) {
			continue;
		}
		if (
			version.annotations?.["workers/tag"] !== undefined &&
			version.annotations["workers/tag"] !== options.tag
		) {
			continue;
		}
		const details = await readWorkerVersionDetails({
			accountId: options.accountId,
			env: options.env,
			fetcher: options.fetcher,
			versionId: version.id,
			workerName: options.workerName,
		});
		if (workerVersionMatches(details, options)) {
			return version;
		}
	}
	return undefined;
}

export function resolveWorkerPlainTextVariable(payload: unknown, variableName: string): string {
	const bindings = isRecord(payload)
		? (payload as unknown as WorkerVersionDetails).resources?.bindings
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
		return fail(
			formatWranglerFailure(
				result,
				`Reading Worker version ${options.versionId} for ${options.workerName}`,
			),
		);
	}
	return resolveWorkerPlainTextVariable(
		parseJsonOutput<unknown>(result.stdout, "wrangler versions view"),
		options.variableName,
	);
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
	env: NodeJS.ProcessEnv = process.env,
): void {
	const authToken = env.SENTRY_AUTH_TOKEN?.trim();
	if (!authToken) {
		fail(`SENTRY_AUTH_TOKEN is required to upload source maps for ${workerName}.`);
	}

	const sentryEnv = { ...env };
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

export async function uploadStagingWorkerVersion(
	options: StagingWorkerVersionOptions,
	dependencies: WorkerVersionUploadDependencies = {},
): Promise<UploadedWorkerVersion> {
	const env = dependencies.env ?? process.env;
	const fetcher = dependencies.fetch ?? fetch;
	const resolveSourceSha = dependencies.resolveSourceSha ?? resolveGitSha;
	const runWrangler = dependencies.runWrangler ?? runWranglerCommand;
	const uploadSourceMaps = dependencies.uploadSourceMaps ?? uploadSentrySourceMaps;
	const sourceSha = resolveSourceSha();
	const tag = resolveWorkerVersionTag(options.buildIdentity, sourceSha);
	const message = `MUC-WIKI/campus-agent@${sourceSha} (${options.appName})`;
	if (
		options.sentrySourceMaps &&
		options.variables.DEPLOYMENT_RELEASE !== options.sentrySourceMaps.release
	) {
		return fail(
			`Sentry source-map release for ${options.workerName} must match the Worker DEPLOYMENT_RELEASE variable.`,
		);
	}
	const args = buildWorkerVersionUploadArgs(options, sourceSha);
	const accountId = requiredEnvironment(env, "CLOUDFLARE_ACCOUNT_ID");
	const versionsBeforeUpload = options.secretsFile
		? await listDeployableWorkerVersions({
				accountId,
				env,
				fetcher,
				workerName: options.workerName,
			})
		: [];
	let version = options.secretsFile
		? undefined
		: await findReusableWorkerVersion({
				accountId,
				bindings: options.expectedBindings ?? [],
				env,
				fetcher,
				message,
				tag,
				variables: options.variables,
				workerName: options.workerName,
			});
	if (!version) {
		const upload = runWrangler(args, { cwd: options.cwd, env, stdio: "inherit" });
		if (upload.status !== 0) {
			return fail(
				formatWranglerFailure(upload, `Uploading Worker version for ${options.workerName}`, env),
			);
		}
		version = await findReusableWorkerVersion({
			accountId,
			bindings: options.expectedBindings ?? [],
			env,
			...(options.secretsFile
				? { excludeVersionIds: new Set(versionsBeforeUpload.map(({ id }) => id)) }
				: {}),
			fetcher,
			message,
			tag,
			variables: options.variables,
			workerName: options.workerName,
		});
		if (!version) {
			return fail(`Uploaded Worker version for ${options.workerName} could not be verified.`);
		}
	} else if (options.sentrySourceMaps?.wranglerOutdir) {
		const bundle = runWrangler([...args, "--dry-run"], {
			cwd: options.cwd,
			env,
			stdio: "inherit",
		});
		if (bundle.status !== 0) {
			return fail(
				formatWranglerFailure(bundle, `Rebuilding source maps for ${options.workerName}`, env),
			);
		}
	}
	if (options.sentrySourceMaps) {
		uploadSourceMaps(options.cwd, options.workerName, options.sentrySourceMaps, env);
	}

	const result = {
		...(options.buildIdentity ? { buildIdentity: options.buildIdentity } : {}),
		...validateCandidateMetadata(options.candidateMetadata),
		workerName: options.workerName,
		versionId: version.id,
		sourceSha,
	};
	const outputPath = env.WORKER_VERSION_OUTPUT?.trim();
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
	const [command, cwd, workerName, versionId, variableName] = argv;
	if (
		argv.length !== 5 ||
		command !== "read-variable" ||
		!cwd ||
		!workerName ||
		!versionId ||
		!variableName
	) {
		console.error(
			"Usage: worker-version.ts read-variable <app-dir> <worker-name> <version-id> <variable-name>",
		);
		return 1;
	}
	console.log(readWorkerVersionPlainTextVariable({ cwd, variableName, versionId, workerName }));
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}

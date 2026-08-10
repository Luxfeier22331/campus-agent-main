import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface CommandResult {
	code: number;
	stderr: string;
	stdout: string;
}

export type CommandOutput = "capture" | "stream";

export type CommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; output: CommandOutput },
) => Promise<CommandResult>;

export interface PublishImageOptions {
	images: string[];
	logger?: (message: string) => void;
	outputFile: string;
	repository: string;
	repositoryRoot: string;
	sourceSha: string;
	summaryFile?: string;
	trivyCacheDirectory: string;
}

type ImageResult = "built" | "failed" | "not-started" | "reused";
type ImageStage = "build" | "inspect" | "scan" | "total";

interface ImageReport {
	buildMs?: number;
	digest?: string;
	failedStage?: Exclude<ImageStage, "total">;
	image: string;
	inspectMs?: number;
	result: ImageResult;
	scanMs?: number;
	startedAt?: number;
	totalMs?: number;
}

interface ImageManifest {
	manifest?: {
		digest?: unknown;
		manifests?: Array<{
			platform?: { architecture?: unknown; os?: unknown };
		}>;
		mediaType?: unknown;
	};
}

function commandError(command: string, args: string[], result: CommandResult): Error {
	const detail =
		[result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") ||
		`exit code ${result.code}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

export async function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; output: CommandOutput },
): Promise<CommandResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			if (options.output === "stream") {
				process.stderr.write(chunk);
			} else {
				stdout += chunk;
			}
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			if (options.output === "stream") {
				process.stderr.write(chunk);
			} else {
				stderr += chunk;
			}
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
	});
}

function elapsed(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}

function logStage(
	logger: (message: string) => void,
	image: string,
	stage: ImageStage,
	state: "complete" | "failed" | "start",
	detail?: string,
): void {
	logger(
		`[release-image] image=${image} stage=${stage} state=${state}${detail ? ` ${detail}` : ""}\n`,
	);
}

function durationCell(duration: number | undefined): string {
	return duration === undefined ? "-" : `${(duration / 1_000).toFixed(1)}s`;
}

async function appendSummary(file: string, reports: ImageReport[]): Promise<void> {
	const rows = reports.map((report) => {
		const result = report.failedStage ? `failed (${report.failedStage})` : report.result;
		return `| ${[
			`\`${report.image}\``,
			result,
			durationCell(report.inspectMs),
			durationCell(report.buildMs),
			durationCell(report.scanMs),
			durationCell(report.totalMs),
			report.digest ? `\`${report.digest}\`` : "-",
		].join(" | ")} |`;
	});
	await appendFile(
		path.resolve(file),
		[
			"### Published image results",
			"",
			"| Image | Result | Inspect | Build/push | Scan | Total | Digest |",
			"| --- | --- | ---: | ---: | ---: | ---: | --- |",
			...rows,
			"",
		].join("\n"),
	);
}

function requiredDigest(value: unknown, context: string): string {
	if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
		throw new Error(`Invalid image digest from ${context}`);
	}
	return value;
}

function existingDigest(source: string, tag: string): string {
	let value: ImageManifest;
	try {
		value = JSON.parse(source) as ImageManifest;
	} catch (error) {
		throw new Error(`Invalid registry response for ${tag}`, { cause: error });
	}
	const manifest = value.manifest;
	const mediaType = manifest?.mediaType;
	if (
		mediaType !== "application/vnd.oci.image.index.v1+json" &&
		mediaType !== "application/vnd.docker.distribution.manifest.list.v2+json"
	) {
		throw new Error(`Existing immutable tag is not a multi-platform index: ${tag}`);
	}
	const linuxPlatforms = (manifest?.manifests ?? [])
		.map((entry) => entry.platform)
		.filter((platform) => platform?.os === "linux");
	const arm64 = linuxPlatforms.filter((platform) => platform?.architecture === "arm64");
	const other = linuxPlatforms.filter((platform) => platform?.architecture !== "arm64");
	if (arm64.length !== 1 || other.length > 0) {
		throw new Error(`Existing immutable tag does not contain exactly one arm64 image: ${tag}`);
	}
	return requiredDigest(manifest?.digest, tag);
}

function bakeTargets(source: string): Set<string> {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error("Docker Bake returned invalid JSON", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Docker Bake output must be an object");
	}
	const target = (value as { target?: unknown }).target;
	if (typeof target !== "object" || target === null || Array.isArray(target)) {
		throw new Error("Docker Bake output does not contain targets");
	}
	return new Set(Object.keys(target));
}

function buildDigest(source: string, image: string): string {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`Invalid Docker Bake metadata for ${image}`, { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Docker Bake metadata for ${image} must be an object`);
	}
	const metadata = (value as Record<string, unknown>)[image];
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		throw new Error(`Docker Bake metadata does not contain ${image}`);
	}
	return requiredDigest(
		(metadata as Record<string, unknown>)["containerimage.digest"],
		`Docker Bake metadata for ${image}`,
	);
}

function normalizedImages(images: string[]): string[] {
	const normalized = [...new Set(images)].sort();
	if (normalized.length !== images.length) {
		throw new Error("Image list contains duplicates");
	}
	for (const image of normalized) {
		if (!IMAGE_PATTERN.test(image)) {
			throw new Error(`Invalid image name: ${image}`);
		}
	}
	return normalized;
}

function validateOptions(options: PublishImageOptions): void {
	if (!REPOSITORY_PATTERN.test(options.repository)) {
		throw new Error(`Invalid repository: ${options.repository}`);
	}
	if (!SHA_PATTERN.test(options.sourceSha)) {
		throw new Error(`Invalid source SHA: ${options.sourceSha}`);
	}
}

export async function publishImages(
	options: PublishImageOptions,
	runner: CommandRunner = runCommand,
): Promise<Record<string, string>> {
	validateOptions(options);
	const images = normalizedImages(options.images);
	const logger = options.logger ?? ((message: string) => process.stderr.write(message));
	const root = path.resolve(options.repositoryRoot);
	const environment = {
		...process.env,
		IMAGE_REVISION: options.sourceSha,
		IMAGE_SOURCE: `https://github.com/${options.repository}`,
	};
	const commandOptions = { cwd: root, env: environment, output: "capture" as const };
	const printArguments = ["buildx", "bake", "--file", "docker-bake.hcl", "--print"];
	const printed = await runner("docker", printArguments, commandOptions);
	if (printed.code !== 0) {
		throw commandError("docker", printArguments, printed);
	}
	const targets = bakeTargets(printed.stdout);
	for (const image of images) {
		if (!targets.has(image)) {
			throw new Error(`Image is not declared in docker-bake.hcl: ${image}`);
		}
	}

	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "campus-agent-images-"));
	const reports = images.map<ImageReport>((image) => ({ image, result: "not-started" }));
	const imageRoot = `ghcr.io/${options.repository.toLowerCase()}`;
	const digests: Record<string, string> = {};
	let failure: { error: unknown } | undefined;
	try {
		for (const [index, image] of images.entries()) {
			const report = reports[index] as ImageReport;
			report.result = "failed";
			const totalStartedAt = performance.now();
			report.startedAt = totalStartedAt;
			const repository = `${imageRoot}/${image}`;
			const tag = `${repository}:${options.sourceSha}`;
			const inspectArguments = ["buildx", "imagetools", "inspect", tag, "--format", "{{json .}}"];
			logStage(logger, image, "total", "start");
			logStage(logger, image, "inspect", "start");
			const inspectStartedAt = performance.now();
			let inspected: CommandResult;
			try {
				inspected = await runner("docker", inspectArguments, commandOptions);
			} catch (error) {
				report.failedStage = "inspect";
				report.inspectMs = elapsed(inspectStartedAt);
				logStage(logger, image, "inspect", "failed", `duration_ms=${report.inspectMs}`);
				throw error;
			}
			report.inspectMs = elapsed(inspectStartedAt);
			let digest: string;
			if (inspected.code === 0) {
				try {
					digest = existingDigest(inspected.stdout, tag);
				} catch (error) {
					report.failedStage = "inspect";
					logStage(logger, image, "inspect", "failed", `duration_ms=${report.inspectMs}`);
					throw error;
				}
				report.result = "reused";
				logStage(
					logger,
					image,
					"inspect",
					"complete",
					`duration_ms=${report.inspectMs} reused=true`,
				);
			} else {
				if (!/manifest unknown|not found|no such manifest/iu.test(inspected.stderr)) {
					report.failedStage = "inspect";
					logStage(
						logger,
						image,
						"inspect",
						"failed",
						`duration_ms=${report.inspectMs} exit_code=${inspected.code}`,
					);
					throw commandError("docker", inspectArguments, inspected);
				}
				logStage(
					logger,
					image,
					"inspect",
					"complete",
					`duration_ms=${report.inspectMs} reused=false`,
				);
				const metadataFile = path.join(temporaryDirectory, `${image}.json`);
				const buildArguments = [
					"buildx",
					"bake",
					"--file",
					"docker-bake.hcl",
					"--metadata-file",
					metadataFile,
					"--progress=plain",
					"--pull",
					"--push",
					"--set",
					`${image}.tags=${tag}`,
					"--set",
					`${image}.cache-from=type=registry,ref=${repository}:buildcache-arm64`,
					"--set",
					`${image}.cache-to=type=registry,ref=${repository}:buildcache-arm64,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true`,
					image,
				];
				logStage(logger, image, "build", "start");
				const buildStartedAt = performance.now();
				let built: CommandResult;
				try {
					built = await runner("docker", buildArguments, {
						cwd: root,
						env: environment,
						output: "stream",
					});
				} catch (error) {
					report.failedStage = "build";
					report.buildMs = elapsed(buildStartedAt);
					logStage(logger, image, "build", "failed", `duration_ms=${report.buildMs}`);
					throw error;
				}
				report.buildMs = elapsed(buildStartedAt);
				if (built.code !== 0) {
					report.failedStage = "build";
					logStage(
						logger,
						image,
						"build",
						"failed",
						`duration_ms=${report.buildMs} exit_code=${built.code}`,
					);
					throw commandError("docker", buildArguments, built);
				}
				try {
					digest = buildDigest(await readFile(metadataFile, "utf8"), image);
				} catch (error) {
					report.failedStage = "build";
					logStage(logger, image, "build", "failed", `duration_ms=${report.buildMs}`);
					throw error;
				}
				report.result = "built";
				logStage(logger, image, "build", "complete", `duration_ms=${report.buildMs}`);
			}
			report.digest = digest;

			const trivyArguments = [
				"image",
				"--cache-dir",
				path.resolve(options.trivyCacheDirectory),
				"--platform",
				"linux/arm64",
				"--scanners",
				"vuln",
				"--ignore-unfixed",
				"--pkg-types",
				"os,library",
				"--severity",
				"HIGH,CRITICAL",
				"--exit-code",
				"1",
				`${repository}@${digest}`,
			];
			logStage(logger, image, "scan", "start");
			const scanStartedAt = performance.now();
			let scanned: CommandResult;
			try {
				scanned = await runner("trivy", trivyArguments, {
					cwd: root,
					env: environment,
					output: "stream",
				});
			} catch (error) {
				report.failedStage = "scan";
				report.scanMs = elapsed(scanStartedAt);
				logStage(logger, image, "scan", "failed", `duration_ms=${report.scanMs}`);
				throw error;
			}
			report.scanMs = elapsed(scanStartedAt);
			if (scanned.code !== 0) {
				report.failedStage = "scan";
				logStage(
					logger,
					image,
					"scan",
					"failed",
					`duration_ms=${report.scanMs} exit_code=${scanned.code}`,
				);
				throw commandError("trivy", trivyArguments, scanned);
			}
			logStage(logger, image, "scan", "complete", `duration_ms=${report.scanMs}`);
			digests[image] = digest;
			report.totalMs = elapsed(totalStartedAt);
			logStage(
				logger,
				image,
				"total",
				"complete",
				`duration_ms=${report.totalMs} result=${report.result} digest=${digest}`,
			);
		}

		const output = path.resolve(options.outputFile);
		const temporaryOutput = `${output}.tmp`;
		await writeFile(temporaryOutput, `${JSON.stringify(digests, null, 2)}\n`);
		await rename(temporaryOutput, output);
	} catch (error) {
		failure = { error };
	} finally {
		for (const report of reports) {
			if (report.result === "failed" && report.totalMs === undefined) {
				report.totalMs = report.startedAt === undefined ? undefined : elapsed(report.startedAt);
				logStage(
					logger,
					report.image,
					"total",
					"failed",
					`duration_ms=${report.totalMs ?? 0} failed_stage=${report.failedStage ?? "unknown"}`,
				);
				break;
			}
		}
		if (options.summaryFile) {
			try {
				await appendSummary(options.summaryFile, reports);
			} catch (error) {
				const originalError = failure !== undefined;
				logger(
					`[release-image] summary state=failed original_error=${originalError} error=${error instanceof Error ? error.message : String(error)}\n`,
				);
				failure ??= { error };
			}
		}
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
	if (failure) {
		throw failure.error;
	}
	return digests;
}

function argumentsMap(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --name value arguments");
		}
		values.set(key.slice(2), value);
	}
	return values;
}

function required(values: Map<string, string>, name: string): string {
	const value = values.get(name);
	if (!value) {
		throw new Error(`Missing --${name}`);
	}
	return value;
}

async function main(args: string[]): Promise<void> {
	const values = argumentsMap(args);
	const images = JSON.parse(required(values, "images")) as unknown;
	if (!Array.isArray(images) || images.some((image) => typeof image !== "string")) {
		throw new Error("--images must be a JSON string array");
	}
	const result = await publishImages({
		images,
		outputFile: required(values, "output"),
		repository: required(values, "repository"),
		repositoryRoot: values.get("root") ?? process.cwd(),
		sourceSha: required(values, "source-sha"),
		summaryFile: values.get("summary"),
		trivyCacheDirectory: values.get("trivy-cache") ?? path.join(os.homedir(), ".cache", "trivy"),
	});
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}

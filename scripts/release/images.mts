import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { readNodeVersion } from "../toolchain/node-version.mts";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_CACHE_TYPE = "registry";
const IMAGE_CACHE_MODE = "max";
const IMAGE_CACHE_TAG = "buildcache-arm64";

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

export interface BuildImagesOptions {
	images: string[];
	logger?: (message: string) => void;
	repository: string;
	repositoryRoot: string;
	sourceSha: string;
	summaryFile?: string;
}

type ImageResult = "built" | "failed" | "not-started" | "reused";
type ImageStage = "build" | "inspect" | "scan" | "total";
type ScanFeedback = "recorded" | "warning";

interface ImageReport {
	buildMs?: number;
	digest?: string;
	failedStage?: Exclude<ImageStage, "total">;
	image: string;
	inspectMs?: number;
	result: ImageResult;
	scanFeedback?: ScanFeedback;
	scanMs?: number;
	startedAt?: number;
	totalMs?: number;
}

interface ImageManifest {
	image?: {
		architecture?: unknown;
		config?: { Labels?: Record<string, unknown> };
		os?: unknown;
	};
	manifest?: {
		digest?: unknown;
		manifests?: Array<{
			annotations?: Record<string, unknown>;
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
	state: "complete" | "failed" | "start" | "warning",
	detail?: string,
): void {
	logger(
		`[release-image] image=${image} stage=${stage} state=${state}${detail ? ` ${detail}` : ""}\n`,
	);
}

function logCommandOutput(
	logger: (message: string) => void,
	result: Pick<CommandResult, "stderr" | "stdout">,
): void {
	for (const output of [result.stdout, result.stderr]) {
		if (output.length > 0) {
			logger(output.endsWith("\n") ? output : `${output}\n`);
		}
	}
}

function scanFeedbackCounts(reports: ImageReport[]): {
	notRun: number;
	recorded: number;
	warnings: number;
} {
	return reports.reduce(
		(counts, report) => {
			if (report.scanFeedback === "recorded") {
				counts.recorded += 1;
			} else if (report.scanFeedback === "warning") {
				counts.warnings += 1;
			} else {
				counts.notRun += 1;
			}
			return counts;
		},
		{ notRun: 0, recorded: 0, warnings: 0 },
	);
}

function logRun(
	logger: (message: string) => void,
	state: "complete" | "failed" | "start",
	detail?: string,
): void {
	logger(`[release-images] stage=run state=${state}${detail ? ` ${detail}` : ""}\n`);
}

function durationCell(duration: number | undefined): string {
	return duration === undefined ? "-" : `${(duration / 1_000).toFixed(1)}s`;
}

function resultCounts(reports: ImageReport[]): Record<ImageResult, number> {
	return reports.reduce(
		(counts, report) => {
			counts[report.result] += 1;
			return counts;
		},
		{
			built: 0,
			failed: 0,
			"not-started": 0,
			reused: 0,
		},
	);
}

function longestImage(reports: ImageReport[]): ImageReport | undefined {
	return [...reports]
		.filter((report) => report.totalMs !== undefined)
		.sort((left, right) => (right.totalMs ?? 0) - (left.totalMs ?? 0))[0];
}

async function appendSummary(file: string, reports: ImageReport[], runMs: number): Promise<void> {
	const counts = resultCounts(reports);
	const scanCounts = scanFeedbackCounts(reports);
	const longest = longestImage(reports);
	const rows = reports.map((report) => {
		const result = report.failedStage ? `failed (${report.failedStage})` : report.result;
		return `| ${[
			`\`${report.image}\``,
			result,
			durationCell(report.inspectMs),
			durationCell(report.buildMs),
			report.scanFeedback ?? "-",
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
			`- Requested images: ${reports.length}`,
			`- Script duration: ${durationCell(runMs)}`,
			`- Cache: ${IMAGE_CACHE_TYPE} with mode=${IMAGE_CACHE_MODE}; per-image ref suffix=:${IMAGE_CACHE_TAG}`,
			`- Results: built=${counts.built} reused=${counts.reused} failed=${counts.failed} not-started=${counts["not-started"]}`,
			`- Trivy feedback: recorded=${scanCounts.recorded} warnings=${scanCounts.warnings} not-run=${scanCounts.notRun}`,
			`- Longest image: ${longest ? `\`${longest.image}\` (${durationCell(longest.totalMs)})` : "-"}`,
			"",
			"| Image | Result | Inspect | Build/push/cache export | Trivy feedback | Scan | Total | Digest |",
			"| --- | --- | ---: | ---: | --- | ---: | ---: | --- |",
			...rows,
			"",
		].join("\n"),
	);
}

async function appendBuildSummary(
	file: string,
	reports: ImageReport[],
	runMs: number,
): Promise<void> {
	const counts = resultCounts(reports);
	const longest = longestImage(reports);
	const rows = reports.map((report) => {
		const result = report.failedStage ? `failed (${report.failedStage})` : report.result;
		return `| ${[
			`\`${report.image}\``,
			result,
			durationCell(report.buildMs),
			durationCell(report.totalMs),
		].join(" | ")} |`;
	});
	await appendFile(
		path.resolve(file),
		[
			"### Container build results",
			"",
			`- Requested images: ${reports.length}`,
			`- Script duration: ${durationCell(runMs)}`,
			"- Output: BuildKit cacheonly; no registry push, image load, or vulnerability scan",
			`- Results: built=${counts.built} reused=${counts.reused} failed=${counts.failed} not-started=${counts["not-started"]}`,
			`- Longest image: ${longest ? `\`${longest.image}\` (${durationCell(longest.totalMs)})` : "-"}`,
			"",
			"| Image | Result | Build | Total |",
			"| --- | --- | ---: | ---: |",
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

function existingDigest(source: string, tag: string, sourceSha: string): string {
	let value: ImageManifest;
	try {
		value = JSON.parse(source) as ImageManifest;
	} catch (error) {
		throw new Error(`Invalid registry response for ${tag}`, { cause: error });
	}
	const manifest = value.manifest;
	const mediaType = manifest?.mediaType;
	const isSinglePlatformManifest =
		mediaType === "application/vnd.oci.image.manifest.v1+json" ||
		mediaType === "application/vnd.docker.distribution.manifest.v2+json";
	const isImageIndex =
		mediaType === "application/vnd.oci.image.index.v1+json" ||
		mediaType === "application/vnd.docker.distribution.manifest.list.v2+json";
	if (!(isSinglePlatformManifest || isImageIndex)) {
		throw new Error(`Existing immutable tag is not a supported image manifest: ${tag}`);
	}
	if (isImageIndex) {
		const runtimeManifests = (manifest.manifests ?? []).filter(
			(entry) => entry.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
		);
		if (
			runtimeManifests.length !== 1 ||
			runtimeManifests[0]?.platform?.os !== "linux" ||
			runtimeManifests[0]?.platform?.architecture !== "arm64"
		) {
			throw new Error(
				`Existing immutable tag does not contain exactly one linux/arm64 image: ${tag}`,
			);
		}
	}
	if (value.image?.os !== "linux" || value.image?.architecture !== "arm64") {
		throw new Error(`Existing immutable tag is not a linux/arm64 image: ${tag}`);
	}
	const revision = value.image.config?.Labels?.["org.opencontainers.image.revision"];
	if (revision !== sourceSha) {
		throw new Error(`Existing immutable tag has the wrong source revision: ${tag}`);
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

function validateBuildOptions(options: BuildImagesOptions): void {
	if (!REPOSITORY_PATTERN.test(options.repository)) {
		throw new Error(`Invalid repository: ${options.repository}`);
	}
	if (!SHA_PATTERN.test(options.sourceSha)) {
		throw new Error(`Invalid source SHA: ${options.sourceSha}`);
	}
}

export async function buildImages(
	options: BuildImagesOptions,
	runner: CommandRunner = runCommand,
): Promise<void> {
	validateBuildOptions(options);
	const images = normalizedImages(options.images);
	const logger = options.logger ?? ((message: string) => process.stderr.write(message));
	const runStartedAt = performance.now();
	logRun(logger, "start", `images_count=${images.length} mode=build-only output=cacheonly`);
	const root = path.resolve(options.repositoryRoot);
	const environment = {
		...process.env,
		IMAGE_REVISION: options.sourceSha,
		IMAGE_SOURCE: `https://github.com/${options.repository}`,
		NODE_VERSION: readNodeVersion(root),
	};
	const commandOptions = { cwd: root, env: environment, output: "capture" as const };
	const printArguments = ["buildx", "bake", "--file", "docker-bake.hcl", "--print"];
	let printed: CommandResult;
	try {
		printed = await runner("docker", printArguments, commandOptions);
	} catch (error) {
		logRun(logger, "failed", `duration_ms=${elapsed(runStartedAt)} failed_stage=preflight`);
		throw error;
	}
	if (printed.code !== 0) {
		logRun(logger, "failed", `duration_ms=${elapsed(runStartedAt)} failed_stage=preflight`);
		throw commandError("docker", printArguments, printed);
	}
	const targets = bakeTargets(printed.stdout);
	for (const image of images) {
		if (!targets.has(image)) {
			throw new Error(`Image is not declared in docker-bake.hcl: ${image}`);
		}
	}

	const reports = images.map<ImageReport>((image) => ({ image, result: "not-started" }));
	let failure: unknown;
	for (const [index, image] of images.entries()) {
		const report = reports[index] as ImageReport;
		report.result = "failed";
		const totalStartedAt = performance.now();
		report.startedAt = totalStartedAt;
		const buildArguments = [
			"buildx",
			"bake",
			"--file",
			"docker-bake.hcl",
			"--progress=plain",
			"--pull",
			"--provenance=false",
			"--sbom=false",
			"--set",
			`${image}.platform=linux/arm64`,
			"--set",
			`${image}.output=type=cacheonly`,
			image,
		];
		logStage(logger, image, "total", "start");
		logStage(logger, image, "build", "start", "mode=build-only output=type=cacheonly");
		const buildStartedAt = performance.now();
		try {
			const built = await runner("docker", buildArguments, {
				cwd: root,
				env: environment,
				output: "stream",
			});
			report.buildMs = elapsed(buildStartedAt);
			if (built.code !== 0) {
				throw commandError("docker", buildArguments, built);
			}
		} catch (error) {
			report.failedStage = "build";
			report.buildMs = elapsed(buildStartedAt);
			failure = error;
			logStage(logger, image, "build", "failed", `duration_ms=${report.buildMs}`);
			break;
		}
		report.result = "built";
		logStage(logger, image, "build", "complete", `duration_ms=${report.buildMs}`);
		report.totalMs = elapsed(totalStartedAt);
		logStage(
			logger,
			image,
			"total",
			"complete",
			`duration_ms=${report.totalMs} result=${report.result}`,
		);
	}
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
			if (failure === undefined) {
				failure = new Error(`Container build failed: ${report.image}`);
			}
			break;
		}
	}
	if (options.summaryFile) {
		try {
			await appendBuildSummary(options.summaryFile, reports, elapsed(runStartedAt));
		} catch (error) {
			logger(
				`[release-image] summary state=failed original_error=${failure !== undefined} error=${error instanceof Error ? error.message : String(error)}\n`,
			);
			failure ??= error;
		}
	}
	const counts = resultCounts(reports);
	logRun(
		logger,
		failure === undefined ? "complete" : "failed",
		[
			`duration_ms=${elapsed(runStartedAt)}`,
			`images_count=${reports.length}`,
			`built=${counts.built}`,
			`reused=${counts.reused}`,
			`failed=${counts.failed}`,
			`not_started=${counts["not-started"]}`,
		].join(" "),
	);
	if (failure !== undefined) {
		throw failure;
	}
}

export async function publishImages(
	options: PublishImageOptions,
	runner: CommandRunner = runCommand,
): Promise<Record<string, string>> {
	validateOptions(options);
	const images = normalizedImages(options.images);
	const logger = options.logger ?? ((message: string) => process.stderr.write(message));
	const runStartedAt = performance.now();
	logRun(
		logger,
		"start",
		`images_count=${images.length} cache_type=${IMAGE_CACHE_TYPE} cache_mode=${IMAGE_CACHE_MODE}`,
	);
	const root = path.resolve(options.repositoryRoot);
	const environment = {
		...process.env,
		IMAGE_REVISION: options.sourceSha,
		IMAGE_SOURCE: `https://github.com/${options.repository}`,
		NODE_VERSION: readNodeVersion(root),
	};
	const commandOptions = { cwd: root, env: environment, output: "capture" as const };
	const printArguments = ["buildx", "bake", "--file", "docker-bake.hcl", "--print"];
	let printed: CommandResult;
	try {
		printed = await runner("docker", printArguments, commandOptions);
	} catch (error) {
		logRun(logger, "failed", `duration_ms=${elapsed(runStartedAt)} failed_stage=preflight`);
		throw error;
	}
	if (printed.code !== 0) {
		logRun(logger, "failed", `duration_ms=${elapsed(runStartedAt)} failed_stage=preflight`);
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
					digest = existingDigest(inspected.stdout, tag, options.sourceSha);
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
				const cacheRef = `${repository}:${IMAGE_CACHE_TAG}`;
				const cacheDetails =
					`cache_type=${IMAGE_CACHE_TYPE} cache_mode=${IMAGE_CACHE_MODE} ` +
					`cache_ref=${cacheRef} duration_scope=build_push_cache_export`;
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
					`${image}.cache-from=type=${IMAGE_CACHE_TYPE},ref=${cacheRef}`,
					"--set",
					`${image}.cache-to=type=${IMAGE_CACHE_TYPE},ref=${cacheRef},mode=${IMAGE_CACHE_MODE},image-manifest=true,oci-mediatypes=true,ignore-error=true`,
					image,
				];
				logStage(logger, image, "build", "start", cacheDetails);
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
					logStage(
						logger,
						image,
						"build",
						"failed",
						`duration_ms=${report.buildMs} ${cacheDetails}`,
					);
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
						`duration_ms=${report.buildMs} exit_code=${built.code} ${cacheDetails}`,
					);
					throw commandError("docker", buildArguments, built);
				}
				try {
					digest = buildDigest(await readFile(metadataFile, "utf8"), image);
				} catch (error) {
					report.failedStage = "build";
					logStage(
						logger,
						image,
						"build",
						"failed",
						`duration_ms=${report.buildMs} ${cacheDetails}`,
					);
					throw error;
				}
				report.result = "built";
				logStage(
					logger,
					image,
					"build",
					"complete",
					`duration_ms=${report.buildMs} ${cacheDetails}`,
				);
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
				"0",
				`${repository}@${digest}`,
			];
			logStage(logger, image, "scan", "start");
			const scanStartedAt = performance.now();
			try {
				const scanned = await runner("trivy", trivyArguments, {
					cwd: root,
					env: environment,
					output: "capture",
				});
				report.scanMs = elapsed(scanStartedAt);
				logCommandOutput(logger, scanned);
				if (scanned.code === 0) {
					report.scanFeedback = "recorded";
					logStage(logger, image, "scan", "complete", `duration_ms=${report.scanMs}`);
				} else {
					report.scanFeedback = "warning";
					logStage(
						logger,
						image,
						"scan",
						"warning",
						`duration_ms=${report.scanMs} exit_code=${scanned.code} blocking=false`,
					);
				}
			} catch (error) {
				report.scanFeedback = "warning";
				report.scanMs = elapsed(scanStartedAt);
				logger(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
				logStage(
					logger,
					image,
					"scan",
					"warning",
					`duration_ms=${report.scanMs} error=execution blocking=false`,
				);
			}
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
				await appendSummary(options.summaryFile, reports, elapsed(runStartedAt));
			} catch (error) {
				const originalError = failure !== undefined;
				logger(
					`[release-image] summary state=failed original_error=${originalError} error=${error instanceof Error ? error.message : String(error)}\n`,
				);
				failure ??= { error };
			}
		}
		const counts = resultCounts(reports);
		logRun(
			logger,
			failure ? "failed" : "complete",
			[
				`duration_ms=${elapsed(runStartedAt)}`,
				`images_count=${reports.length}`,
				`built=${counts.built}`,
				`reused=${counts.reused}`,
				`failed=${counts.failed}`,
				`not_started=${counts["not-started"]}`,
			].join(" "),
		);
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
	const mode = values.get("mode") ?? "publish";
	if (mode === "build-only") {
		await buildImages({
			images,
			repository: required(values, "repository"),
			repositoryRoot: values.get("root") ?? process.cwd(),
			sourceSha: required(values, "source-sha"),
			summaryFile: values.get("summary"),
		});
		return;
	}
	if (mode !== "publish") {
		throw new Error(`Unsupported image build mode: ${mode}`);
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

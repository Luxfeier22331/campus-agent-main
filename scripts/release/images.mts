import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { readNodeVersion } from "../toolchain/node-version.mts";
import { BuildkitProgress, type BuildkitReport, renderBuildkit } from "./buildkit-progress.mts";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_CACHE_TAG = "buildcache-arm64";

export interface CommandResult {
	code: number;
	stderr: string;
	stdout: string;
	buildkit?: BuildkitReport;
	signal?: NodeJS.Signals | null;
}

export type CommandOutput = "capture" | "stream" | "buildkit";

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
	cacheImportRegistries?: string[];
	cacheExportRegistry?: string;
	images: string[];
	logger?: (message: string) => void;
	repository: string;
	repositoryRoot: string;
	sourceSha: string;
	summaryFile?: string;
}

type ImageResult = "built" | "failed" | "not-started" | "reused" | "unfinished";
type ImageStage = "build" | "inspect" | "scan" | "total";
type ScanFeedback = "recorded" | "warning";

interface ImageReport {
	buildkit?: BuildkitReport;
	buildMs?: number;
	digest?: string;
	failedStage?: Exclude<ImageStage, "total">;
	image: string;
	inspectMs?: number;
	result: ImageResult;
	scanFeedback?: ScanFeedback;
	scanMs?: number;
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
		const progress =
			options.output === "buildkit"
				? new BuildkitProgress((text) => process.stderr.write(text))
				: undefined;
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			if (progress) {
				progress.push(chunk, "stdout");
			} else if (options.output === "stream") {
				process.stderr.write(chunk);
			} else {
				stdout += chunk;
			}
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			if (progress) {
				progress.push(chunk, "stderr");
			} else if (options.output === "stream") {
				process.stderr.write(chunk);
			} else {
				stderr += chunk;
			}
		});
		child.once("error", reject);
		child.once("close", (code, signal) =>
			resolve({ code: code ?? 1, stderr, stdout, signal, buildkit: progress?.finish(signal) }),
		);
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
			unfinished: 0,
			reused: 0,
		},
	);
}

interface BakeBatch {
	name: "heavy" | "standard";
	images: string[];
}

interface BatchReport extends BakeBatch {
	durationMs: number;
	result: "success" | "failure";
	cacheExport?: BuildkitReport["cacheExport"];
}

async function appendSummary(
	file: string,
	reports: ImageReport[],
	batches: BatchReport[],
	runMs: number,
	mode: string,
): Promise<void> {
	const counts = resultCounts(reports);
	const scans = scanFeedbackCounts(reports);
	await appendFile(
		path.resolve(file),
		[
			mode === "build-only" ? "### Container build results" : "### Published image results",
			"",
			`- Mode: ${mode}; Script duration: ${durationCell(runMs)}`,
			`- Cache: registry with mode=max; per-image ref suffix=:${IMAGE_CACHE_TAG}`,
			...(mode === "build-only"
				? ["- Output: BuildKit cacheonly; cache export when configured"]
				: []),
			...(batches.length === 0 ? ["Build and cache export: not run."] : []),
			`- Results: built=${counts.built} reused=${counts.reused} failed=${counts.failed} unfinished=${counts.unfinished} not-started=${counts["not-started"]}`,
			`- Trivy feedback: recorded=${scans.recorded} warnings=${scans.warnings} not-run=${scans.notRun}`,
			"",
			"| Image | Result | Inspect | Scan feedback | Scan | Digest |",
			"| --- | --- | ---: | --- | ---: | --- |",
			...reports.map(
				(r) =>
					`| \`${r.image}\` | ${r.failedStage ? `failed (${r.failedStage})` : r.result} | ${durationCell(r.inspectMs)} | ${r.scanFeedback ?? "-"} | ${durationCell(r.scanMs)} | ${r.digest ?? "-"} |`,
			),
			"",
			"| Batch | Targets | Result | Build/push/cache export wall time |",
			"| --- | --- | --- | ---: |",
			...batches.map(
				(b) =>
					`| ${b.name} | ${b.images.join(", ")} | ${b.result} | ${durationCell(b.durationMs)} |`,
			),
			...reports
				.filter((r) => r.buildMs !== undefined)
				.flatMap((r) => [
					"",
					`#### Build phases: ${r.image} (${durationCell(r.buildMs)})`,
					"",
					r.buildkit
						? renderBuildkit(r.buildkit)
						: "Build observations: unavailable; cache export outcome unknown.",
				]),
			"",
			"Images run serially. Batch wall time is measured once; image phases are reported separately.",
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

export function bakeBatches(source: string, images: string[]): BakeBatch[] {
	const value = JSON.parse(source) as {
		target?: Record<string, unknown>;
		group?: Record<string, { targets: string[] }>;
	};
	if (!(value?.target && value.group)) {
		throw new Error("Docker Bake output must contain targets and heavy/standard groups");
	}
	const batches: BakeBatch[] = [];
	for (const name of ["heavy", "standard"] as const) {
		const targets = value.group[name]?.targets;
		if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string")) {
			throw new Error(`Docker Bake group is missing or invalid: ${name}`);
		}
		batches.push({ name, images: images.filter((image) => targets.includes(image)) });
	}
	for (const image of images) {
		if (!Object.hasOwn(value.target, image)) {
			throw new Error(`Image is not declared in docker-bake.hcl: ${image}`);
		}
		if (batches.filter((batch) => batch.images.includes(image)).length !== 1) {
			throw new Error(`Image must belong to exactly one Bake group: ${image}`);
		}
	}
	return batches.filter((batch) => batch.images.length > 0);
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
	if (
		options.cacheImportRegistries !== undefined &&
		(!Array.isArray(options.cacheImportRegistries) ||
			options.cacheImportRegistries.some((value) => typeof value !== "string" || !value.trim()))
	) {
		throw new Error("Cache imports must be a JSON array of registry prefixes");
	}
	if (!REPOSITORY_PATTERN.test(options.repository)) {
		throw new Error(`Invalid repository: ${options.repository}`);
	}
	if (!SHA_PATTERN.test(options.sourceSha)) {
		throw new Error(`Invalid source SHA: ${options.sourceSha}`);
	}
}

function buildEnvironment(options: BuildImagesOptions | PublishImageOptions): NodeJS.ProcessEnv {
	return {
		...process.env,
		IMAGE_REVISION: options.sourceSha,
		IMAGE_SOURCE: `https://github.com/${options.repository}`,
		NODE_VERSION: readNodeVersion(options.repositoryRoot),
	};
}

async function planBatches(
	images: string[],
	root: string,
	env: NodeJS.ProcessEnv,
	runner: CommandRunner,
): Promise<BakeBatch[]> {
	const args = ["buildx", "bake", "--file", "docker-bake.hcl", "--print", "heavy", "standard"];
	const printed = await runner("docker", args, { cwd: root, env, output: "capture" });
	if (printed.code !== 0) {
		throw commandError("docker", args, printed);
	}
	return bakeBatches(printed.stdout, images);
}

function cacheArguments(image: string, imports: string[], exported?: string): string[] {
	const args: string[] = [];
	for (const [index, prefix] of [...new Set(imports)].entries()) {
		args.push(
			"--set",
			`${image}.cache-from${index === 0 ? "=" : "+="}type=registry,ref=${prefix.toLowerCase()}/${image}:${IMAGE_CACHE_TAG}`,
		);
	}
	if (exported) {
		args.push(
			"--set",
			`${image}.cache-to=type=registry,ref=${exported.toLowerCase()}/${image}:${IMAGE_CACHE_TAG},mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true`,
		);
	}
	return args;
}

async function runBatch(
	batch: BakeBatch,
	overrides: (image: string) => string[],
	root: string,
	env: NodeJS.ProcessEnv,
	runner: CommandRunner,
	logger: (message: string) => void,
	batches: BatchReport[],
	reports: ImageReport[],
	metadataDirectory?: string,
): Promise<void> {
	const selected = reports.filter((report) => batch.images.includes(report.image));
	const started = performance.now();
	logger(
		`[release-batch] ${JSON.stringify({ batch: batch.name, images: batch.images, state: "start" })}\n`,
	);
	const report: BatchReport = { ...batch, durationMs: 0, result: "failure" };
	batches.push(report);
	try {
		for (const image of selected) {
			image.result = "unfinished";
			const imageStarted = performance.now();
			const metadata = metadataDirectory && path.join(metadataDirectory, `${image.image}.json`);
			const args = [
				"buildx",
				"bake",
				"--file",
				"docker-bake.hcl",
				"--progress=rawjson",
				"--pull",
				...overrides(image.image),
				...(metadata ? ["--metadata-file", metadata] : []),
				image.image,
			];
			logStage(logger, image.image, "build", "start");
			try {
				const built = await runner("docker", args, { cwd: root, env, output: "buildkit" });
				image.buildkit = built.buildkit;
				if (built.code !== 0) {
					const errors =
						built.buildkit?.operations.flatMap((op) => (op.error ? [op.error] : [])) ?? [];
					const canceled =
						built.signal ||
						built.buildkit?.signal ||
						(errors.every((error) => /cancel(?:led|ed)/iu.test(error)) &&
							/cancel(?:led|ed)/iu.test([built.stderr, ...errors].join("\n")));
					if (!canceled) {
						image.result = "failed";
						image.failedStage = "build";
					}
					throw commandError("docker", args, built);
				}
				if (metadata) {
					const source = await readFile(metadata, "utf8");
					try {
						image.digest = buildDigest(source, image.image);
					} catch (error) {
						image.result = "failed";
						image.failedStage = "build";
						throw error;
					}
				}
				image.result = "built";
			} finally {
				image.buildMs = elapsed(imageStarted);
				logStage(
					logger,
					image.image,
					"build",
					image.result === "built" ? "complete" : "failed",
					`duration_ms=${image.buildMs} result=${image.result}`,
				);
			}
		}
		report.result = "success";
	} finally {
		report.durationMs = elapsed(started);
		const cacheStates = selected
			.filter((image) => image.buildMs !== undefined)
			.map((image) => image.buildkit?.cacheExport ?? "unknown");
		report.cacheExport =
			(["warning", "unfinished", "unknown", "success", "not-run"] as const).find((state) =>
				cacheStates.includes(state),
			) ?? "unknown";
		logger(
			`[release-batch] ${JSON.stringify({
				batch: batch.name,
				images: batch.images,
				state: report.result,
				durationMs: report.durationMs,
				cacheExport: report.cacheExport,
			})}\n`,
		);
	}
}

export async function buildImages(
	options: BuildImagesOptions,
	runner: CommandRunner = runCommand,
): Promise<void> {
	validateBuildOptions(options);
	const images = normalizedImages(options.images);
	const root = path.resolve(options.repositoryRoot);
	const env = buildEnvironment(options);
	const logger = options.logger ?? ((message: string) => process.stderr.write(message));
	const started = performance.now();
	const reports = images.map<ImageReport>((image) => ({ image, result: "not-started" }));
	const batches: BatchReport[] = [];
	let failure: unknown;
	logRun(logger, "start", `images_count=${images.length} mode=build-only output=cacheonly`);
	try {
		for (const batch of await planBatches(images, root, env, runner)) {
			const overrides = (image: string) => [
				"--provenance=false",
				"--sbom=false",
				"--set",
				`${image}.platform=linux/arm64`,
				"--set",
				`${image}.output=type=cacheonly`,
				...cacheArguments(image, options.cacheImportRegistries ?? [], options.cacheExportRegistry),
			];
			await runBatch(batch, overrides, root, env, runner, logger, batches, reports);
		}
	} catch (error) {
		failure = error;
	}
	if (options.summaryFile) {
		try {
			await appendSummary(options.summaryFile, reports, batches, elapsed(started), "build-only");
		} catch (error) {
			logger(
				`[release-image] summary state=failed original_error=${failure !== undefined} error=${String(error)}\n`,
			);
			failure ??= error;
		}
	}
	logRun(
		logger,
		failure ? "failed" : "complete",
		`duration_ms=${elapsed(started)} images_count=${images.length} built=${resultCounts(reports).built} failed=${resultCounts(reports).failed} unfinished=${resultCounts(reports).unfinished} not_started=${resultCounts(reports)["not-started"]}`,
	);
	if (failure) {
		throw failure;
	}
}

export async function publishImages(
	options: PublishImageOptions,
	runner: CommandRunner = runCommand,
): Promise<Record<string, string>> {
	validateOptions(options);
	const images = normalizedImages(options.images);
	const root = path.resolve(options.repositoryRoot);
	const env = buildEnvironment(options);
	const commandOptions = { cwd: root, env, output: "capture" as const };
	const logger = options.logger ?? ((message: string) => process.stderr.write(message));
	const started = performance.now();
	const reports = images.map<ImageReport>((image) => ({ image, result: "not-started" }));
	const batches: BatchReport[] = [];
	const imageRoot = `ghcr.io/${options.repository.toLowerCase()}`;
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "campus-agent-images-"));
	const digests: Record<string, string> = {};
	let failure: unknown;
	logRun(logger, "start", `images_count=${images.length} cache_type=registry cache_mode=max`);
	try {
		const planned = await planBatches(images, root, env, runner);
		for (const report of reports) {
			const tag = `${imageRoot}/${report.image}:${options.sourceSha}`;
			const args = ["buildx", "imagetools", "inspect", tag, "--format", "{{json .}}"];
			const inspectStarted = performance.now();
			logStage(logger, report.image, "inspect", "start");
			try {
				const inspected = await runner("docker", args, commandOptions);
				if (inspected.code === 0) {
					report.digest = existingDigest(inspected.stdout, tag, options.sourceSha);
					report.result = "reused";
				} else if (!/manifest unknown|not found|no such manifest/iu.test(inspected.stderr)) {
					throw commandError("docker", args, inspected);
				}
			} catch (error) {
				report.result = "failed";
				report.failedStage = "inspect";
				throw error;
			} finally {
				report.inspectMs = elapsed(inspectStarted);
				logStage(
					logger,
					report.image,
					"inspect",
					report.failedStage ? "failed" : "complete",
					`duration_ms=${report.inspectMs} reused=${report.result === "reused"}`,
				);
			}
		}
		for (const plannedBatch of planned) {
			const batch = {
				...plannedBatch,
				images: plannedBatch.images.filter(
					(image) => !reports.find((r) => r.image === image)?.digest,
				),
			};
			if (batch.images.length === 0) {
				continue;
			}
			const overrides = (image: string) => [
				"--push",
				"--set",
				`${image}.tags=${imageRoot}/${image}:${options.sourceSha}`,
				...cacheArguments(image, [imageRoot], imageRoot),
			];
			await runBatch(
				batch,
				overrides,
				root,
				env,
				runner,
				logger,
				batches,
				reports,
				temporaryDirectory,
			);
		}
		for (const report of reports) {
			const digest = requiredDigest(report.digest, report.image);
			const args = [
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
				`${imageRoot}/${report.image}@${digest}`,
			];
			const scanStarted = performance.now();
			let scanDetails = "";
			logStage(logger, report.image, "scan", "start");
			try {
				const scanned = await runner("trivy", args, commandOptions);
				logCommandOutput(logger, scanned);
				report.scanFeedback = scanned.code === 0 ? "recorded" : "warning";
				scanDetails = `exit_code=${scanned.code}`;
			} catch (error) {
				report.scanFeedback = "warning";
				scanDetails = "error=execution";
				logger(`${String(error)}\n`);
			}
			report.scanMs = elapsed(scanStarted);
			logStage(
				logger,
				report.image,
				"scan",
				report.scanFeedback === "recorded" ? "complete" : "warning",
				`duration_ms=${report.scanMs} ${scanDetails} blocking=false`,
			);
			digests[report.image] = digest;
		}
		const output = path.resolve(options.outputFile);
		await writeFile(`${output}.tmp`, `${JSON.stringify(digests, null, 2)}\n`);
		await rename(`${output}.tmp`, output);
	} catch (error) {
		failure = error;
	} finally {
		if (options.summaryFile) {
			try {
				await appendSummary(options.summaryFile, reports, batches, elapsed(started), "publish");
			} catch (error) {
				logger(
					`[release-image] summary state=failed original_error=${failure !== undefined} error=${String(error)}\n`,
				);
				failure ??= error;
			}
		}
		logRun(
			logger,
			failure ? "failed" : "complete",
			`duration_ms=${elapsed(started)} images_count=${images.length} built=${resultCounts(reports).built} reused=${resultCounts(reports).reused} unfinished=${resultCounts(reports).unfinished}`,
		);
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
	if (failure) {
		throw failure;
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
			cacheImportRegistries: JSON.parse(values.get("cache-import-registries") ?? "[]") as string[],
			cacheExportRegistry: values.get("cache-export-registry"),
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

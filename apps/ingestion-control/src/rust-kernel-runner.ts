import { spawn } from "node:child_process";
import { statSync } from "node:fs";

import {
	assertArtifactRefBytes,
	assertIngestionKernelOutputSucceeded,
	buildIngestionKernelArtifactKey,
	buildObjectStoreArtifactRef,
	type CollectionChunkProfile,
	DEFAULT_EXECUTABLE_RUST_KERNEL_IDS,
	type DefaultExecutableRustKernelId,
	INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE,
	parseIngestionKernelJsonOutput,
	parseS3Uri,
} from "ingest-core";

import type { IngestionObjectStore } from "./object-store";
import { type RustKernelHandler, RustKernelRegistry } from "./task-executor";

const DEFAULT_RUNNER_PATH = "ingestion-kernel-runner";
const DEFAULT_CHUNK_SIZE = 384;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP = 64;

export interface RustKernelCommandInput {
	executable: string;
	args: string[];
	signal?: AbortSignal;
	stdin: Uint8Array;
}

export interface RustKernelCommandOutput {
	exitCode: number | null;
	signal: string | null;
	stdout: Uint8Array;
	stderr: string;
}

export type RustKernelCommandRunner = (
	input: RustKernelCommandInput,
) => Promise<RustKernelCommandOutput>;

export interface DefaultRustKernelRegistryOptions {
	chunkProfiles?: ReadonlyMap<string, CollectionChunkProfile>;
	chunkSize?: number;
	commandRunner?: RustKernelCommandRunner;
	minTokens?: number;
	maxTokens?: number;
	objectStore?: IngestionObjectStore;
	overlap?: number;
	runnerPath?: string;
	tokenizerJsonPath?: string;
}

export function createDefaultRustKernelRegistry(
	options: DefaultRustKernelRegistryOptions = {},
): RustKernelRegistry {
	const registry = new RustKernelRegistry();
	if (!options.objectStore) {
		return registry;
	}
	const runnerPath =
		options.runnerPath?.trim() ||
		process.env.INGESTION_KERNEL_RUNNER_PATH?.trim() ||
		DEFAULT_RUNNER_PATH;
	const commandRunner = options.commandRunner ?? runRustKernelCommand;
	const defaultChunkOptions = resolveChunkOptions(options);
	for (const kernelId of DEFAULT_EXECUTABLE_RUST_KERNEL_IDS) {
		if (kernelId === "build-retrieval-chunks-v2" && !defaultChunkOptions) {
			continue;
		}
		registry.register(
			kernelId,
			createRustKernelHandler({
				chunkProfiles: options.chunkProfiles ?? new Map(),
				commandRunner,
				defaultChunkOptions,
				kernelId,
				objectStore: options.objectStore,
				runnerPath,
			}),
		);
	}
	return registry;
}

function createRustKernelHandler(input: {
	chunkProfiles: ReadonlyMap<string, CollectionChunkProfile>;
	commandRunner: RustKernelCommandRunner;
	defaultChunkOptions: RustChunkKernelOptions | null;
	kernelId: DefaultExecutableRustKernelId;
	objectStore: IngestionObjectStore;
	runnerPath: string;
}): RustKernelHandler {
	return async (snapshot, options) => {
		const task = snapshot.task;
		const source = parseS3Uri(task.input_ref);
		const stdin = await input.objectStore.getObject({ ...source, abortSignal: options?.signal });
		options?.signal?.throwIfAborted();
		assertArtifactRefBytes({
			bytes: stdin,
			label: "Rust kernel input_ref",
			ref: task.input_ref,
		});
		const result = await input.commandRunner({
			executable: input.runnerPath,
			args: kernelArgs({
				chunkOptions: resolveTaskChunkOptions(input, snapshot.registry_task.target),
				kernelId: input.kernelId,
			}),
			signal: options?.signal,
			stdin,
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`ingestion kernel ${input.kernelId} failed with exit code ${String(
					result.exitCode,
				)}${kernelFailureDetails(result)}`,
			);
		}
		const output = parseIngestionKernelJsonOutput({
			expectedSchemaVersion: snapshot.registry_task.output_contract,
			kernelId: input.kernelId,
			stdout: result.stdout,
		});
		assertIngestionKernelOutputSucceeded({
			errorCount: output.errorCount,
			errors: output.errors,
			kernelId: input.kernelId,
		});
		const artifactKey = buildIngestionKernelArtifactKey({
			activityAttempt: options?.activityAttempt ?? 1,
			kernelId: input.kernelId,
			task,
		});
		const write = await input.objectStore.createOrVerifyObject({
			abortSignal: options?.signal,
			bucket: input.objectStore.derivedBucket,
			key: artifactKey,
			body: output.bytes,
			contentType: INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE,
		});
		options?.signal?.throwIfAborted();
		return {
			schema_version: "ingestion_task_result.v1",
			task_id: task.task_id,
			run_id: task.run_id,
			registry_task_id: task.registry_task_id,
			output_contract: snapshot.registry_task.output_contract,
			result_ref: buildObjectStoreArtifactRef({
				bucket: input.objectStore.derivedBucket,
				byteSize: write.byteSize,
				key: artifactKey,
				contentSha256: write.contentSha256,
			}),
			summary: {
				error_count: output.errorCount,
				kernel_id: input.kernelId,
			},
		};
	};
}

function resolveTaskChunkOptions(
	input: {
		chunkProfiles: ReadonlyMap<string, CollectionChunkProfile>;
		defaultChunkOptions: RustChunkKernelOptions | null;
	},
	target: { corpus: string; collection: string } | undefined,
): RustChunkKernelOptions | null {
	const profile = target ? input.chunkProfiles.get(collectionProfileKey(target)) : undefined;
	if (!(profile && input.defaultChunkOptions)) {
		return input.defaultChunkOptions;
	}
	return {
		...input.defaultChunkOptions,
		chunkSize: profile.runtimeDefaults.chunkSize,
		maxTokens: profile.runtimeDefaults.maxChunkSize,
		minTokens: profile.runtimeDefaults.minChunkSize,
		overlap: profile.runtimeDefaults.chunkOverlap,
	};
}

function collectionProfileKey(input: { corpus: string; collection: string }): string {
	return `${input.corpus}/${input.collection}`;
}

async function runRustKernelCommand(
	input: RustKernelCommandInput,
): Promise<RustKernelCommandOutput> {
	return new Promise((resolve, reject) => {
		const child = spawn(input.executable, input.args, {
			signal: input.signal,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", reject);
		child.once("close", (exitCode, signal) => {
			resolve({
				exitCode,
				signal,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
		child.stdin.end(input.stdin);
	});
}

interface RustChunkKernelOptions {
	chunkSize: number;
	maxTokens: number;
	minTokens: number;
	overlap: number;
	tokenizerJsonPath: string;
}

function kernelArgs(input: {
	chunkOptions: RustChunkKernelOptions | null;
	kernelId: DefaultExecutableRustKernelId;
}): string[] {
	if (input.kernelId === "build-retrieval-chunks-v2") {
		if (!input.chunkOptions) {
			throw new Error("build-retrieval-chunks-v2 requires tokenizer options");
		}
		return [
			input.kernelId,
			"--tokenizer-json",
			input.chunkOptions.tokenizerJsonPath,
			"--chunk-size",
			String(input.chunkOptions.chunkSize),
			"--max-tokens",
			String(input.chunkOptions.maxTokens),
			"--overlap",
			String(input.chunkOptions.overlap),
			"--min-tokens",
			String(input.chunkOptions.minTokens),
		];
	}
	return [input.kernelId];
}

function resolveChunkOptions(
	options: DefaultRustKernelRegistryOptions,
): RustChunkKernelOptions | null {
	const tokenizerJsonPath =
		options.tokenizerJsonPath?.trim() || process.env.INGESTION_KERNEL_TOKENIZER_JSON_PATH?.trim();
	if (!tokenizerJsonPath) {
		return null;
	}
	if (!statSync(tokenizerJsonPath, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`INGESTION_KERNEL_TOKENIZER_JSON_PATH is not a file: ${tokenizerJsonPath}`);
	}
	const chunkSize = requiredPositiveInteger(options.chunkSize ?? DEFAULT_CHUNK_SIZE, "chunkSize");
	const maxTokens = requiredPositiveInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, "maxTokens");
	const minTokens = requiredPositiveInteger(options.minTokens ?? 1, "minTokens");
	const overlap = requiredNonnegativeInteger(options.overlap ?? DEFAULT_OVERLAP, "overlap");
	if (chunkSize > maxTokens) {
		throw new Error("chunkSize must be less than or equal to maxTokens");
	}
	if (minTokens > maxTokens) {
		throw new Error("minTokens must be less than or equal to maxTokens");
	}
	if (overlap >= chunkSize) {
		throw new Error("overlap must be less than chunkSize");
	}
	return {
		chunkSize,
		maxTokens,
		minTokens,
		overlap,
		tokenizerJsonPath,
	};
}

function requiredPositiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

function requiredNonnegativeInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a nonnegative integer`);
	}
	return value;
}

function kernelFailureDetails(result: RustKernelCommandOutput): string {
	const details = result.stderr.trim();
	if (details) {
		return `: ${details.slice(0, 2000)}`;
	}
	if (result.signal) {
		return `, signal ${result.signal}`;
	}
	return "";
}

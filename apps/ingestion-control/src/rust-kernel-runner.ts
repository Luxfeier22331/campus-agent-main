import { spawn } from "node:child_process";

import type { IngestionObjectStore } from "./authenticated-notice-materialize";
import {
	type RustKernelHandler,
	RustKernelRegistry,
	type TsTaskHandlerResult,
} from "./task-executor";
import type { IngestionArtifactRef, IngestionTaskRecord } from "./types";

const DEFAULT_RUNNER_PATH = "ingestion-kernel-runner";
const DEFAULT_CHUNK_MAX_CHARS = 4000;
const EXECUTABLE_KERNEL_IDS = [
	"validate-document-units",
	"chunk-document-units",
	"validate-release-manifest",
] as const;

type ExecutableKernelId = (typeof EXECUTABLE_KERNEL_IDS)[number];

export interface RustKernelCommandInput {
	executable: string;
	args: string[];
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
	chunkMaxChars?: number;
	commandRunner?: RustKernelCommandRunner;
	objectStore?: IngestionObjectStore;
	runnerPath?: string;
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
	const chunkMaxChars = requiredPositiveInteger(
		options.chunkMaxChars ?? DEFAULT_CHUNK_MAX_CHARS,
		"chunkMaxChars",
	);
	for (const kernelId of EXECUTABLE_KERNEL_IDS) {
		registry.register(
			kernelId,
			createRustKernelHandler({
				chunkMaxChars,
				commandRunner,
				kernelId,
				objectStore: options.objectStore,
				runnerPath,
			}),
		);
	}
	return registry;
}

function createRustKernelHandler(input: {
	chunkMaxChars: number;
	commandRunner: RustKernelCommandRunner;
	kernelId: ExecutableKernelId;
	objectStore: IngestionObjectStore;
	runnerPath: string;
}): RustKernelHandler {
	return async (task): Promise<TsTaskHandlerResult> => {
		const source = parseS3Uri(task.input_ref);
		const stdin = await input.objectStore.getObject(source);
		const result = await input.commandRunner({
			executable: input.runnerPath,
			args: kernelArgs(input.kernelId, input.chunkMaxChars),
			stdin,
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`ingestion kernel ${input.kernelId} failed with exit code ${String(
					result.exitCode,
				)}${kernelFailureDetails(result)}`,
			);
		}
		const output = requireKernelOutputJson({
			expectedSchemaVersion: task.output_contract,
			kernelId: input.kernelId,
			stdout: result.stdout,
		});
		const artifactKey = rustKernelArtifactKey({
			kernelId: input.kernelId,
			task,
		});
		const write = await input.objectStore.putObject({
			bucket: source.bucket,
			key: artifactKey,
			body: output.bytes,
			contentType: "application/json",
		});
		return {
			artifactRefs: [
				{
					kind: "object_store",
					uri: `s3://${source.bucket}/${artifactKey}`,
					digest: `sha256:${write.contentSha256}`,
				},
			],
		};
	};
}

async function runRustKernelCommand(
	input: RustKernelCommandInput,
): Promise<RustKernelCommandOutput> {
	return new Promise((resolve, reject) => {
		const child = spawn(input.executable, input.args, {
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

function kernelArgs(kernelId: ExecutableKernelId, chunkMaxChars: number): string[] {
	if (kernelId === "chunk-document-units") {
		return [kernelId, "--max-chars", String(chunkMaxChars)];
	}
	return [kernelId];
}

function requireKernelOutputJson(input: {
	expectedSchemaVersion: string;
	kernelId: string;
	stdout: Uint8Array;
}): { bytes: Uint8Array; value: Record<string, unknown> } {
	const text = Buffer.from(input.stdout).toString("utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`ingestion kernel ${input.kernelId} stdout must be JSON: ${errorMessage(error)}`,
		);
	}
	if (!isRecord(parsed)) {
		throw new Error(`ingestion kernel ${input.kernelId} stdout must be a JSON object`);
	}
	if (parsed.schema_version !== input.expectedSchemaVersion) {
		throw new Error(
			`ingestion kernel ${input.kernelId} stdout expected schema_version ${input.expectedSchemaVersion}`,
		);
	}
	return {
		bytes: input.stdout,
		value: parsed,
	};
}

function rustKernelArtifactKey(input: { kernelId: string; task: IngestionTaskRecord }): string {
	return [
		"ingestion-kernels",
		safeKeySegment(input.task.corpus, "corpus"),
		safeKeySegment(input.task.collection, "collection"),
		safeKeySegment(input.task.run_id, "run_id"),
		safeKeySegment(input.task.task_id, "task_id"),
		`${safeKeySegment(input.kernelId, "kernel_id")}.json`,
	].join("/");
}

function parseS3Uri(ref: IngestionArtifactRef): { bucket: string; key: string } {
	if (ref.kind !== "object_store") {
		throw new Error(`input_ref must be object_store, got ${ref.kind}`);
	}
	if (!ref.uri.startsWith("s3://")) {
		throw new Error(`input_ref object_store uri must use s3://, got ${ref.uri}`);
	}
	const rest = ref.uri.slice("s3://".length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		throw new Error(`invalid s3 uri: ${ref.uri}`);
	}
	return {
		bucket: rest.slice(0, slash),
		key: rest.slice(slash + 1),
	};
}

function safeKeySegment(value: string, label: string): string {
	if (!/^[A-Za-z0-9_.:-]+$/u.test(value)) {
		throw new Error(`${label} is not safe for ingestion kernel artifact key`);
	}
	return value;
}

function requiredPositiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

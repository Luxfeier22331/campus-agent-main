import {
	assertArtifactByteSize,
	assertIngestionKernelOutputSucceeded,
	assertSha256Digest,
	canonicalJsonString,
	parseIngestionKernelJsonOutput,
	parseJsonObjectBytes,
	parseS3Uri,
	sha256Hex,
} from "ingest-core";
import type { IngestionTaskExecutionSnapshot, IngestionTaskResult } from "ingestion-contracts";
import type { IngestionObjectStore } from "./object-store";

export class IngestionResultArtifactContractError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "IngestionResultArtifactContractError";
	}
}

export async function verifyIngestionTaskResultArtifact(input: {
	objectStore: IngestionObjectStore;
	result: IngestionTaskResult;
	snapshot: IngestionTaskExecutionSnapshot;
}): Promise<void> {
	let location: ReturnType<typeof parseS3Uri>;
	try {
		location = parseS3Uri(input.result.result_ref);
	} catch (error) {
		throw contractError("ingestion task result_ref is invalid", error);
	}
	await verifyPinnedArtifactHead(
		input.objectStore,
		input.result.result_ref,
		"ingestion task result_ref",
	);

	let bytes: Uint8Array;
	try {
		bytes = await input.objectStore.getObject(location);
	} catch (error) {
		if (isObjectNotFoundError(error)) {
			throw contractError(
				`ingestion task result artifact is missing: ${input.result.result_ref.uri}`,
			);
		}
		throw error;
	}

	try {
		assertSha256Digest({
			actualSha256: sha256Hex(bytes),
			digest: input.result.result_ref.digest,
			label: "ingestion task result_ref",
		});
		assertArtifactByteSize({
			actualByteSize: bytes.byteLength,
			byteSize: input.result.result_ref.byte_size,
			label: "ingestion task result_ref",
		});
		if (input.snapshot.registry_task.executor_kind === "rust_kernel") {
			verifyRustKernelArtifact(bytes, input.result, input.snapshot);
			return;
		}
		await verifySourceCollectorManifest(input.objectStore, bytes, input.result);
	} catch (error) {
		if (error instanceof IngestionResultArtifactContractError) {
			throw error;
		}
		throw contractError("ingestion task result artifact violates its frozen contract", error);
	}
}

function verifyRustKernelArtifact(
	bytes: Uint8Array,
	result: IngestionTaskResult,
	snapshot: IngestionTaskExecutionSnapshot,
): void {
	const kernelId = snapshot.registry_task.kernel_id;
	if (!kernelId) {
		throw contractError("rust kernel result is missing frozen kernel_id");
	}
	const parsed = parseIngestionKernelJsonOutput({
		expectedSchemaVersion: result.output_contract,
		kernelId,
		stdout: bytes,
	});
	assertIngestionKernelOutputSucceeded({
		errorCount: parsed.errorCount,
		errors: parsed.errors,
		kernelId,
	});
}

async function verifySourceCollectorManifest(
	objectStore: IngestionObjectStore,
	bytes: Uint8Array,
	result: IngestionTaskResult,
): Promise<void> {
	const manifest = parseJsonObjectBytes(bytes, "source collector result manifest");
	for (const [field, expected] of [
		["schema_version", result.output_contract],
		["task_id", result.task_id],
		["run_id", result.run_id],
		["registry_task_id", result.registry_task_id],
	] as const) {
		if (manifest[field] !== expected) {
			throw contractError(`source collector result manifest ${field} does not match task result`);
		}
	}
	if (canonicalJsonString(manifest.summary) !== canonicalJsonString(result.summary)) {
		throw contractError("source collector result manifest summary does not match task result");
	}
	if (!Array.isArray(manifest.artifacts)) {
		throw contractError("source collector result manifest artifacts must be an array");
	}
	for (const [index, artifact] of manifest.artifacts.entries()) {
		const ref = parseArtifactRef(artifact, index);
		await verifyPinnedArtifactHead(
			objectStore,
			ref,
			`source collector result manifest artifact ${index}`,
		);
	}
}

function parseArtifactRef(value: unknown, index: number): IngestionTaskResult["result_ref"] {
	if (!isRecord(value) || value.kind !== "object_store") {
		throw contractError(`source collector result manifest artifact ${index} is invalid`);
	}
	if (
		typeof value.uri !== "string" ||
		typeof value.digest !== "string" ||
		typeof value.byte_size !== "number" ||
		!Number.isSafeInteger(value.byte_size) ||
		value.byte_size < 0
	) {
		throw contractError(`source collector result manifest artifact ${index} is invalid`);
	}
	if (!/^sha256:[0-9a-f]{64}$/u.test(value.digest)) {
		throw contractError(`source collector result manifest artifact ${index} digest is invalid`);
	}
	try {
		parseS3Uri({ kind: "object_store", uri: value.uri });
	} catch (error) {
		throw contractError(`source collector result manifest artifact ${index} URI is invalid`, error);
	}
	return {
		byte_size: value.byte_size,
		digest: value.digest,
		kind: "object_store",
		uri: value.uri,
	};
}

async function verifyPinnedArtifactHead(
	objectStore: IngestionObjectStore,
	ref: IngestionTaskResult["result_ref"],
	label: string,
): Promise<void> {
	const location = parseS3Uri(ref);
	let head: Awaited<ReturnType<IngestionObjectStore["headObject"]>>;
	try {
		head = await objectStore.headObject(location);
	} catch (error) {
		if (isObjectNotFoundError(error)) {
			throw contractError(`${label} is missing: ${ref.uri}`);
		}
		throw error;
	}
	try {
		assertSha256Digest({
			actualSha256: head.contentSha256 ?? "",
			digest: ref.digest,
			label,
		});
		assertArtifactByteSize({
			actualByteSize: head.byteSize ?? -1,
			byteSize: ref.byte_size,
			label,
		});
	} catch (error) {
		throw contractError(`${label} metadata does not match its pinned ref`, error);
	}
}

function isObjectNotFoundError(error: unknown): boolean {
	if (!isRecord(error)) {
		return false;
	}
	if (error.name === "NoSuchKey" || error.name === "NotFound") {
		return true;
	}
	const metadata = error.$metadata;
	return isRecord(metadata) && metadata.httpStatusCode === 404;
}

function contractError(message: string, cause?: unknown): IngestionResultArtifactContractError {
	return new IngestionResultArtifactContractError(
		message,
		cause === undefined ? undefined : { cause },
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

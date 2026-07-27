import {
	assertArtifactByteSize,
	assertIngestionKernelOutputSucceeded,
	assertSha256Digest,
	encodeObjectKeySegment,
	parseIngestionKernelJsonOutput,
	parseS3Uri,
	sha256Hex,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
} from "ingestion-contracts";
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
	const location = parseResultLocation(input.result.result_ref);
	assertResultRefOwnership(input.objectStore, input.snapshot, location);
	await verifyPinnedArtifactHead(input.objectStore, input.result.result_ref);
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
		const kernelId = input.snapshot.registry_task.kernel_id;
		if (!kernelId) {
			throw new Error("rust kernel result is missing frozen kernel_id");
		}
		const parsed = parseIngestionKernelJsonOutput({
			expectedSchemaVersion: input.result.output_contract,
			kernelId,
			stdout: bytes,
		});
		assertIngestionKernelOutputSucceeded({
			errorCount: parsed.errorCount,
			errors: parsed.errors,
			kernelId,
		});
	} catch (error) {
		throw contractError("ingestion task result artifact violates its frozen contract", error);
	}
}

function parseResultLocation(ref: IngestionArtifactRef): ReturnType<typeof parseS3Uri> {
	try {
		return parseS3Uri(ref);
	} catch (error) {
		throw contractError("ingestion task result_ref is invalid", error);
	}
}

function assertResultRefOwnership(
	objectStore: IngestionObjectStore,
	snapshot: IngestionTaskExecutionSnapshot,
	location: ReturnType<typeof parseS3Uri>,
): void {
	const kernelId = snapshot.registry_task.kernel_id?.trim();
	if (!kernelId) {
		throw contractError("ingestion task result is missing its frozen kernel_id");
	}
	const expected = [
		"ingestion-kernels",
		encodeObjectKeySegment(snapshot.task.registry_task_id),
		"runs",
		encodeObjectKeySegment(snapshot.task.run_id),
		"attempts",
	].join("/");
	const suffix = [
		encodeObjectKeySegment(snapshot.task.task_id),
		`${encodeObjectKeySegment(kernelId)}.json`,
	].join("/");
	const relative = location.key.slice(expected.length + 1);
	const [attempt, ...rest] = relative.split("/");
	if (
		location.bucket !== objectStore.derivedBucket ||
		!location.key.startsWith(`${expected}/`) ||
		!attempt ||
		!/^[1-9]\d*$/u.test(attempt) ||
		rest.join("/") !== suffix
	) {
		throw contractError(
			`ingestion task result_ref is outside its executor namespace: s3://${location.bucket}/${location.key}`,
		);
	}
}

async function verifyPinnedArtifactHead(
	objectStore: IngestionObjectStore,
	ref: IngestionTaskResult["result_ref"],
): Promise<void> {
	let head: Awaited<ReturnType<IngestionObjectStore["headObject"]>>;
	try {
		head = await objectStore.headObject(parseS3Uri(ref));
	} catch (error) {
		if (isObjectNotFoundError(error)) {
			throw contractError(`ingestion task result_ref is missing: ${ref.uri}`);
		}
		throw error;
	}
	try {
		assertSha256Digest({
			actualSha256: head.contentSha256 ?? "",
			digest: ref.digest,
			label: "ingestion task result_ref",
		});
		assertArtifactByteSize({
			actualByteSize: head.byteSize ?? -1,
			byteSize: ref.byte_size,
			label: "ingestion task result_ref",
		});
	} catch (error) {
		throw contractError("ingestion task result_ref metadata does not match its pinned ref", error);
	}
}

function isObjectNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as {
		$metadata?: { httpStatusCode?: number };
		name?: string;
	};
	return (
		candidate.name === "NoSuchKey" ||
		candidate.name === "NotFound" ||
		candidate.$metadata?.httpStatusCode === 404
	);
}

function contractError(message: string, cause?: unknown): IngestionResultArtifactContractError {
	return new IngestionResultArtifactContractError(
		message,
		cause === undefined ? undefined : { cause },
	);
}

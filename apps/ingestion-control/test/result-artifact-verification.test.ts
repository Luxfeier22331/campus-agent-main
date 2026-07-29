import { buildObjectStoreArtifactRef, sha256Hex } from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
} from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import type { IngestionObjectStore } from "../src/object-store";
import { verifyIngestionTaskResultArtifact } from "../src/result-artifact-verification";
import { testSnapshot } from "./fixtures";

describe("ingestion result artifact verification", () => {
	it("accepts a Rust kernel result in its frozen namespace", async () => {
		await expect(verifyIngestionTaskResultArtifact(kernelFixture())).resolves.toBeUndefined();
	});

	it.each([
		[
			"bucket",
			"s3://foreign/ingestion-kernels/curriculum.curriculum_plan.chunk_prepare/runs/run-curriculum-001/attempts/1/task-curriculum-chunk-001/build-retrieval-chunks-v2.json",
		],
		[
			"key",
			"s3://derived/ingestion-kernels/foreign-task/runs/run-curriculum-001/attempts/1/task-curriculum-chunk-001/build-retrieval-chunks-v2.json",
		],
	])("rejects a result_ref outside its Rust kernel %s namespace", async (_label, uri) => {
		const fixture = kernelFixture();
		fixture.result.result_ref = { ...fixture.result.result_ref, uri };
		await expect(verifyIngestionTaskResultArtifact(fixture)).rejects.toThrow(
			"outside its executor namespace",
		);
	});

	it("rejects a kernel result whose bytes violate the frozen output contract", async () => {
		const fixture = kernelFixture({
			schema_version: "wrong_contract.v1",
			chunk_count: 0,
			chunks: [],
			error_count: 0,
			errors: [],
		});

		await expect(verifyIngestionTaskResultArtifact(fixture)).rejects.toThrow(
			"violates its frozen contract",
		);
	});
});

class MemoryObjectStore implements IngestionObjectStore {
	readonly sourceBucket = "source";
	readonly derivedBucket = "derived";
	readonly objects = new Map<string, Uint8Array>();

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		const value = this.objects.get(`${input.bucket}/${input.key}`);
		if (!value) {
			throw new Error(`missing object: ${input.bucket}/${input.key}`);
		}
		return value;
	}

	async headObject(input: { bucket: string; key: string }) {
		const body = await this.getObject(input);
		return { byteSize: body.byteLength, contentSha256: sha256Hex(body) };
	}

	async createOrVerifyObject(input: { body: Uint8Array; bucket: string; key: string }) {
		this.objects.set(`${input.bucket}/${input.key}`, input.body);
		return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
	}

	writeJson(bucket: string, key: string, value: unknown): IngestionArtifactRef {
		const body = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
		this.objects.set(`${bucket}/${key}`, body);
		return buildObjectStoreArtifactRef({
			bucket,
			byteSize: body.byteLength,
			contentSha256: sha256Hex(body),
			key,
		});
	}
}

function kernelFixture(
	output: unknown = {
		chunk_count: 0,
		chunks: [],
		error_count: 0,
		errors: [],
		schema_version: "retrieval_chunk_set.v2",
	},
): {
	objectStore: MemoryObjectStore;
	result: IngestionTaskResult;
	snapshot: IngestionTaskExecutionSnapshot;
} {
	const objectStore = new MemoryObjectStore();
	const snapshot = testSnapshot();
	const resultRef = objectStore.writeJson(
		"derived",
		"ingestion-kernels/curriculum.curriculum_plan.chunk_prepare/runs/run-curriculum-001/attempts/1/task-curriculum-chunk-001/build-retrieval-chunks-v2.json",
		output,
	);
	return {
		objectStore,
		result: {
			output_contract: "retrieval_chunk_set.v2",
			registry_task_id: snapshot.task.registry_task_id,
			result_ref: resultRef,
			run_id: snapshot.task.run_id,
			schema_version: "ingestion_task_result.v1",
			summary: { chunk_count: 0 },
			task_id: snapshot.task.task_id,
		},
		snapshot,
	};
}

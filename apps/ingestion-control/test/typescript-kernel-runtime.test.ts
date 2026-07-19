import { fileURLToPath } from "node:url";
import { sha256Hex } from "ingest-core";
import type { IngestionTaskExecutionSnapshot } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import type { IngestionObjectStore } from "../src/object-store";
import {
	assertTypeScriptKernelRegistryCoversTasks,
	createDefaultTypeScriptKernelRegistry,
	parseTypeScriptKernelInputStageResult,
	TypeScriptKernelRegistry,
} from "../src/typescript-kernel-runner";

const digest = `sha256:${"1".repeat(64)}`;

describe("TypeScript ingestion kernel runtime", () => {
	it("requires every TypeScript task to name a registered kernel", () => {
		const registry = new TypeScriptKernelRegistry();
		registry.register("materialize-notice", async () => {
			throw new Error("not executed");
		});

		expect(() =>
			assertTypeScriptKernelRegistryCoversTasks(
				[{ executor_kind: "typescript_kernel", kernel_id: "materialize-notice" }],
				registry,
			),
		).not.toThrow();
		expect(() =>
			assertTypeScriptKernelRegistryCoversTasks([{ executor_kind: "typescript_kernel" }], registry),
		).toThrow("<missing kernel_id>");
		expect(() =>
			assertTypeScriptKernelRegistryCoversTasks(
				[{ executor_kind: "typescript_kernel", kernel_id: "unknown" }],
				registry,
			),
		).toThrow("unknown");
	});

	it("accepts only the capture result from the same publication run", () => {
		const snapshot = noticeMaterializationSnapshot();
		const input = noticeCaptureResult();

		expect(parseTypeScriptKernelInputStageResult(input, snapshot)).toMatchObject({
			registry_task_id: "internal_portal.notice.capture",
			run_id: snapshot.task.run_id,
		});
		expect(() =>
			parseTypeScriptKernelInputStageResult({ ...input, run_id: "other-run" }, snapshot),
		).toThrow("input identity does not match");
		expect(() =>
			parseTypeScriptKernelInputStageResult(
				{ ...input, registry_task_id: "internal_portal.file_release.capture" },
				snapshot,
			),
		).toThrow("input identity does not match");
	});

	it("reads captured file-release bytes from source and writes materialized artifacts to derived", async () => {
		const objectStore = new TwoBucketObjectStore();
		const sourceFile = new TextEncoder().encode("released file");
		const sourceFileKey = "internal_portal/files/646/released.pdf";
		objectStore.putBytes("source", sourceFileKey, sourceFile);
		const bundleKey = "internal_portal/runs/run-001/file-releases-bundle.json";
		const manifestKey = "internal_portal/runs/run-001/file-releases-manifest.json";
		const bundleRef = objectStore.putJson("source", bundleKey, [
			fileReleaseBundleRecord(sourceFileKey, sourceFile),
		]);
		const manifestRef = objectStore.putJson("source", manifestKey, fileReleaseExportManifest());
		const captureRef = objectStore.putJson("source", "ingestion-results/capture.json", {
			artifacts: [
				{ ...bundleRef, role: "source_bundle" },
				{ ...manifestRef, role: "export_manifest" },
			],
			registry_task_id: "internal_portal.file_release.capture",
			run_id: "run-001",
			schema_version: "internal_portal_file_release_capture_result.v1",
			summary: { file_count: 1 },
			task_id: "run-001:capture",
		});
		const snapshot = fileReleaseMaterializationSnapshot(captureRef);
		const registry = createDefaultTypeScriptKernelRegistry({
			objectStore,
			registryRoot: fileURLToPath(new URL("../../../configs/ingestion", import.meta.url)),
		});

		const result = await registry.require(snapshot)(snapshot, { activityAttempt: 1 });

		expect(result.result_ref.uri).toMatch(/^s3:\/\/derived\//u);
		expect(objectStore.writtenBuckets()).toEqual(new Set(["derived"]));
		expect(objectStore.readLocations()).toEqual(
			expect.arrayContaining([
				`s3://source/${sourceFileKey}`,
				`s3://source/${bundleKey}`,
				`s3://source/${manifestKey}`,
			]),
		);
		const stageResult = objectStore.readJson(result.result_ref.uri) as {
			artifacts: Array<{ uri: string }>;
			items: Array<{ artifacts: Array<{ uri: string }> }>;
		};
		expect(stageResult.artifacts.every((ref) => ref.uri.startsWith("s3://derived/"))).toBe(true);
		expect(
			stageResult.items
				.flatMap((item) => item.artifacts)
				.every((ref) => ref.uri.startsWith("s3://derived/")),
		).toBe(true);
	});
});

function noticeMaterializationSnapshot(): IngestionTaskExecutionSnapshot {
	return {
		registry_task: {
			executor_kind: "typescript_kernel",
			input_contract: "internal_portal_notice_capture_result.v1",
			kernel_id: "materialize-internal-portal-notice",
			output_contract: "internal_portal_notice_materialization_result.v1",
			registry_task_id: "campus_notices.internal_notice.materialize",
			target: { collection: "internal_notice", corpus: "campus_notices" },
		},
		schema_version: "ingestion_task_execution_snapshot.v1",
		task: {
			input_ref: artifact("source", "capture-result.json"),
			registry_task_id: "campus_notices.internal_notice.materialize",
			run_id: "run-001",
			schema_version: "ingestion_task_envelope.v3",
			task_id: "run-001:materialize",
		},
	};
}

function noticeCaptureResult() {
	return {
		artifacts: [
			{ ...artifact("source", "capture-release.json"), role: "capture_release" },
			{ ...artifact("source", "checkpoint.json"), role: "capture_checkpoint" },
		],
		registry_task_id: "internal_portal.notice.capture",
		run_id: "run-001",
		schema_version: "internal_portal_notice_capture_result.v1",
		summary: { notice_count: 1 },
		task_id: "run-001:capture",
	};
}

function fileReleaseMaterializationSnapshot(
	inputRef: ReturnType<TwoBucketObjectStore["putJson"]>,
): IngestionTaskExecutionSnapshot {
	return {
		registry_task: {
			executor_kind: "typescript_kernel",
			input_contract: "internal_portal_file_release_capture_result.v1",
			kernel_id: "materialize-internal-portal-file-release",
			output_contract: "internal_portal_file_release_materialization_result.v1",
			registry_task_id: "authenticated_documents.file_release_source.materialize",
			target: { collection: "file_release_source", corpus: "authenticated_documents" },
		},
		schema_version: "ingestion_task_execution_snapshot.v1",
		task: {
			input_ref: inputRef,
			registry_task_id: "authenticated_documents.file_release_source.materialize",
			run_id: "run-001",
			schema_version: "ingestion_task_envelope.v3",
			task_id: "run-001:materialize",
		},
	};
}

class TwoBucketObjectStore implements IngestionObjectStore {
	readonly derivedBucket = "derived";
	readonly sourceBucket = "source";
	readonly #objects = new Map<string, Uint8Array>();
	readonly #reads: string[] = [];
	readonly #writes = new Set<string>();

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		const uri = `s3://${input.bucket}/${input.key}`;
		this.#reads.push(uri);
		const bytes = this.#objects.get(uri);
		if (!bytes) {
			throw new Error(`missing object: ${uri}`);
		}
		return bytes;
	}

	async headObject(input: { bucket: string; key: string }) {
		const bytes = this.#objects.get(`s3://${input.bucket}/${input.key}`);
		return {
			byteSize: bytes?.byteLength ?? null,
			contentSha256: bytes ? sha256Hex(bytes) : null,
		};
	}

	async createOrVerifyObject(input: { body: Uint8Array; bucket: string; key: string }) {
		this.#writes.add(input.bucket);
		this.#objects.set(`s3://${input.bucket}/${input.key}`, input.body);
		return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
	}

	putBytes(bucket: string, key: string, bytes: Uint8Array) {
		this.#objects.set(`s3://${bucket}/${key}`, bytes);
		return artifact(bucket, key, bytes);
	}

	putJson(bucket: string, key: string, value: unknown) {
		return this.putBytes(
			bucket,
			key,
			new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
		);
	}

	readJson(uri: string): unknown {
		const bytes = this.#objects.get(uri);
		if (!bytes) {
			throw new Error(`missing object: ${uri}`);
		}
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	}

	readLocations(): string[] {
		return [...this.#reads];
	}

	writtenBuckets(): Set<string> {
		return new Set(this.#writes);
	}
}

function fileReleaseBundleRecord(sourceFileKey: string, sourceFile: Uint8Array) {
	return {
		file_release: {
			explain_department: "教务处",
			file_type_id: 1,
			file_type_name: "制度文件",
			filecode: "校发〔2026〕646号",
			filedepartment: "学校办公室",
			filename: "制度-646",
			filetime: "2026-04-12 08:30",
			resolved_download_url: "https://portal.example.edu/file/646.pdf",
			upfilename: "制度-646.pdf",
		},
		file_release_id: 646,
		released_file: {
			bucket: "source",
			byte_size: sourceFile.byteLength,
			final_url: "https://portal.example.edu/file/646.pdf",
			mime_type: "application/pdf",
			object_key: sourceFileKey,
			original_filename: "制度-646.pdf",
			sha256: sha256Hex(sourceFile),
			source_url: "https://portal.example.edu/file/646.pdf",
			storage_provider: "object_store",
		},
	};
}

function fileReleaseExportManifest() {
	return {
		capture_runtime: { export_contract_version: "internal_portal_file_release_export_v1" },
		exported_at: "2026-04-12T00:30:00.000Z",
		schema_version: "internal_portal_file_release_export_v1",
		site_id: "synthetic_internal_portal",
		source_channel: "internal_portal",
		source_home_url: "https://portal.example.edu/",
		source_surface: "file_release",
	};
}

function artifact(bucket: string, key: string, bytes?: Uint8Array) {
	return {
		byte_size: bytes?.byteLength ?? 1,
		digest: bytes ? `sha256:${sha256Hex(bytes)}` : digest,
		kind: "object_store" as const,
		uri: `s3://${bucket}/${key}`,
	};
}

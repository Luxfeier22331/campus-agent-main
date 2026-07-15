import { resolve } from "node:path";
import { sha256Hex } from "ingest-core";
import type { IngestionTaskExecutionSnapshot } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import { createDefaultRustKernelRegistry } from "../src/rust-kernel-runner";
import { assertRustKernelRegistryCoversTasks, RustKernelRegistry } from "../src/task-executor";

const objectStore = {
	derivedBucket: "campus-agent-derived",
	async getObject(): Promise<Uint8Array> {
		return new Uint8Array();
	},
	async createOrVerifyObject() {
		return { byteSize: 0, contentSha256: "0".repeat(64) };
	},
	async headObject() {
		return { byteSize: 0, contentSha256: "0".repeat(64) };
	},
};

describe("Rust kernel worker runtime", () => {
	it("fails startup when a registry kernel is not configured", () => {
		const registry = new RustKernelRegistry();

		expect(() =>
			assertRustKernelRegistryCoversTasks(
				[
					{
						executor_kind: "rust_kernel",
						input_contract: "canonical_document_units.v1",
						kernel_id: "chunk-document-units",
						output_contract: "ingestion_chunk_set.v1",
						registry_task_id: "regulations.student_rules.chunk_prepare",
						target: { collection: "student_rules", corpus: "regulations" },
					},
				],
				registry,
			),
		).toThrow("regulations.student_rules.chunk_prepare:chunk-document-units");
	});

	it("registers chunking only with a readable local tokenizer", () => {
		const tokenizerJsonPath = resolve(
			import.meta.dirname,
			"../../../packages/ingestion-kernels-rs/tests/tokenizer.json",
		);
		const registry = createDefaultRustKernelRegistry({ objectStore, tokenizerJsonPath });

		expect(registry.has("chunk-document-units")).toBe(true);
		expect(() =>
			createDefaultRustKernelRegistry({
				objectStore,
				tokenizerJsonPath: "/missing/tokenizer.json",
			}),
		).toThrow("INGESTION_KERNEL_TOKENIZER_JSON_PATH is not a file");
	});

	it("propagates Temporal cancellation through object I/O and the Rust process", async () => {
		const source = new TextEncoder().encode("{}\n");
		const output = new TextEncoder().encode(
			JSON.stringify({
				error_count: 0,
				errors: [],
				schema_version: "document_units_validation_report.v1",
				unit_count: 1,
			}),
		);
		const controller = new AbortController();
		const observedSignals: Array<AbortSignal | undefined> = [];
		const registry = createDefaultRustKernelRegistry({
			commandRunner: async (input) => {
				observedSignals.push(input.signal);
				return { exitCode: 0, signal: null, stderr: "", stdout: output };
			},
			objectStore: {
				derivedBucket: "campus-agent-derived",
				async getObject(input) {
					observedSignals.push(input.abortSignal);
					return source;
				},
				async createOrVerifyObject(input) {
					observedSignals.push(input.abortSignal);
					return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
				},
				async headObject() {
					return { byteSize: 0, contentSha256: "0".repeat(64) };
				},
			},
		});
		const snapshot: IngestionTaskExecutionSnapshot = {
			schema_version: "ingestion_task_execution_snapshot.v1",
			task: {
				schema_version: "ingestion_task_envelope.v3",
				task_id: "task-validate-001",
				run_id: "run-validate-001",
				registry_task_id: "regulations.student_rules.document_units_validate",
				input_ref: {
					byte_size: source.byteLength,
					kind: "object_store",
					uri: "s3://campus-agent-source/document-units.jsonl",
					digest: `sha256:${sha256Hex(source)}`,
				},
			},
			registry_task: {
				executor_kind: "rust_kernel",
				input_contract: "canonical_document_units.v1",
				kernel_id: "validate-document-units",
				output_contract: "document_units_validation_report.v1",
				registry_task_id: "regulations.student_rules.document_units_validate",
				target: { collection: "student_rules", corpus: "regulations" },
			},
		};

		await registry.require("validate-document-units")(snapshot, {
			signal: controller.signal,
		});

		expect(observedSignals).toEqual([controller.signal, controller.signal, controller.signal]);
	});
});

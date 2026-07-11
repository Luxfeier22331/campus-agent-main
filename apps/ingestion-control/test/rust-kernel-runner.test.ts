import { createHash } from "node:crypto";
import { type CollectionChunkProfile, DEFAULT_EXECUTABLE_RUST_KERNEL_IDS } from "ingest-core";
import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import {
	createDefaultRustKernelRegistry,
	type IngestionTaskEnvelope,
	type IngestionTaskRegistry,
	type RustKernelCommandRunner,
} from "../src/index.ts";
import { TsTaskHandlerRegistry } from "../src/task-executor";
import { runDeclaredTaskForTest } from "./test-support.ts";

const inputKey = "canonical-document-units/student-rules.jsonl";
const validDocumentUnitsJsonl =
	'{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}\n';

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_student_rules_document_units_validate_001",
	run_id: "run_student_rules_20260630",
	source_family: "regulations",
	source_channel: "student_rules",
	corpus: "regulations",
	collection: "student_rules",
	registry_task_id: "document_units_validate",
	task_kind: "document_units_validate",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-agent-source/${inputKey}`,
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
	created_by: "operator",
	created_at: "2026-06-30T00:00:00Z",
};

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "regulations",
	corpus: "regulations",
	collection: "student_rules",
	tasks: [
		{
			registry_task_id: "document_units_validate",
			task_kind: "document_units_validate",
			executor_kind: "rust_kernel",
			kernel_id: "validate-document-units",
			input_contract: "canonical_document_units.v1",
			output_contract: "document_units_validation_report.v1",
		},
	],
};

describe("Rust ingestion kernel runner bridge", () => {
	it("registers every default executable Rust kernel when object-store access is configured", () => {
		const rustKernels = createDefaultRustKernelRegistry({
			commandRunner: async () => ({
				exitCode: 0,
				signal: null,
				stdout: Buffer.from("{}", "utf8"),
				stderr: "",
			}),
			objectStore: new InMemoryObjectStore("campus-agent-source"),
			tokenizerJsonPath: "/models/qwen3/tokenizer.json",
		});

		expect(rustKernels.registeredKernelIds()).toEqual(DEFAULT_EXECUTABLE_RUST_KERNEL_IDS);
	});

	it("runs the declared Rust kernel binary bridge and stores its JSON artifact", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, validDocumentUnitsJsonl);
		const runnerCalls: Parameters<RustKernelCommandRunner>[0][] = [];
		const commandRunner: RustKernelCommandRunner = async (input) => {
			runnerCalls.push(input);
			return {
				exitCode: 0,
				signal: null,
				stdout: Buffer.from(
					`${JSON.stringify({
						schema_version: "document_units_validation_report.v1",
						unit_count: 1,
						error_count: 0,
						errors: [],
					})}\n`,
					"utf8",
				),
				stderr: "",
			};
		};

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				commandRunner,
				objectStore,
				runnerPath: "/usr/local/bin/ingestion-kernel-runner",
			}),
			taskId: task.task_id,
		});

		expect(result.status).toBe("completed");
		expect(runnerCalls).toHaveLength(1);
		expect(runnerCalls[0]).toMatchObject({
			executable: "/usr/local/bin/ingestion-kernel-runner",
			args: ["validate-document-units"],
		});
		expect(Buffer.from(runnerCalls[0].stdin).toString("utf8")).toBe(validDocumentUnitsJsonl);
		const artifact = result.task?.closeout?.artifact_refs[0];
		expect(artifact).toEqual({
			kind: "object_store",
			uri: "s3://campus-agent-source/ingestion-kernels/regulations/student_rules/run_student_rules_20260630/task_student_rules_document_units_validate_001/validate-document-units.json",
			digest: `sha256:${sha256(objectStore.getRequiredObjectFromUri(requiredString(artifact?.uri)))}`,
		});
		const stored = JSON.parse(
			Buffer.from(objectStore.getRequiredObjectFromUri(requiredString(artifact?.uri))).toString(
				"utf8",
			),
		) as Record<string, unknown>;
		expect(stored.schema_version).toBe("document_units_validation_report.v1");
	});

	it("does not register Rust kernels when source-bucket access is missing", () => {
		const rustKernels = createDefaultRustKernelRegistry();

		expect(() => rustKernels.require("validate-document-units")).toThrow(
			"Rust kernel not registered: validate-document-units",
		);
	});

	it("passes tokenizer and token budget arguments to the chunk-document-units kernel", async () => {
		const chunkTask: IngestionTaskEnvelope = {
			...task,
			task_id: "task_student_rules_chunk_prepare_001",
			registry_task_id: "chunk_prepare",
			task_kind: "chunk_prepare",
			input_contract: "canonical_document_units.v1",
			output_contract: "ingestion_chunk_set.v1",
			idempotency_key: "regulations/student_rules/chunk_prepare/release-001",
		};
		const chunkRegistry: IngestionTaskRegistry = {
			...registry,
			tasks: [
				{
					registry_task_id: "chunk_prepare",
					task_kind: "chunk_prepare",
					executor_kind: "rust_kernel",
					kernel_id: "chunk-document-units",
					input_contract: "canonical_document_units.v1",
					output_contract: "ingestion_chunk_set.v1",
				},
			],
		};
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(chunkTask);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, validDocumentUnitsJsonl);
		const runnerCalls: Parameters<RustKernelCommandRunner>[0][] = [];

		const result = await runDeclaredTaskForTest({
			store,
			registry: chunkRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				chunkProfiles: new Map<string, CollectionChunkProfile>([
					[
						"regulations/student_rules",
						{
							collection: "student_rules",
							corpus: "regulations",
							chunkProfileVersion: "student_rules_semantic_v3",
							cleaningPolicyVersion: "student_rules_cleaning_v1",
							laneDefaults: {},
							runtimeDefaults: {
								chunkOverlap: 12,
								chunkSize: 72,
								maxChunkSize: 160,
								minChunkSize: 24,
								strategyName: "student_rules_test_profile",
							},
							structuredInput: "document_units_jsonl",
						},
					],
				]),
				chunkSize: 64,
				commandRunner: async (input) => {
					runnerCalls.push(input);
					return {
						exitCode: 0,
						signal: null,
						stdout: Buffer.from(
							`${JSON.stringify({
								schema_version: "ingestion_chunk_set.v1",
								chunk_count: 1,
								chunks: [
									{
										chunk_id: "doc1::chunk::000001",
										doc_id: "doc1",
										unit_ids: ["u1"],
										text: "hello",
									},
								],
								error_count: 0,
								errors: [],
							})}\n`,
							"utf8",
						),
						stderr: "",
					};
				},
				maxTokens: 128,
				minTokens: 16,
				objectStore,
				overlap: 8,
				tokenizerJsonPath: "/models/qwen3/tokenizer.json",
			}),
			taskId: chunkTask.task_id,
		});

		expect(result.status).toBe("completed");
		expect(runnerCalls[0].args).toEqual([
			"chunk-document-units",
			"--tokenizer-json",
			"/models/qwen3/tokenizer.json",
			"--chunk-size",
			"72",
			"--max-tokens",
			"160",
			"--overlap",
			"12",
			"--min-tokens",
			"24",
		]);
	});

	it("does not register chunk-document-units when tokenizer path is missing", () => {
		const rustKernels = createDefaultRustKernelRegistry({
			commandRunner: async () => ({
				exitCode: 0,
				signal: null,
				stdout: Buffer.from("{}", "utf8"),
				stderr: "",
			}),
			objectStore: new InMemoryObjectStore("campus-agent-source"),
		});

		expect(rustKernels.registeredKernelIds()).toEqual([
			"validate-document-units",
			"validate-release-manifest",
		]);
		expect(() => rustKernels.require("chunk-document-units")).toThrow(
			"Rust kernel not registered: chunk-document-units",
		);
	});

	it("fails closed when the runner exits non-zero", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, '{"bad":true}\n');

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				commandRunner: async () => ({
					exitCode: 2,
					signal: null,
					stdout: Buffer.from("", "utf8"),
					stderr: "invalid document units",
				}),
				objectStore,
			}),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"ingestion kernel validate-document-units failed with exit code 2",
		);
		expect(
			[...objectStore.objects.keys()].filter((key) => key.startsWith("ingestion-kernels/")),
		).toHaveLength(0);
	});

	it("fails closed when stdout does not match the task output contract schema", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, '{"bad":true}\n');

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				commandRunner: async () => ({
					exitCode: 0,
					signal: null,
					stdout: Buffer.from('{"schema_version":"wrong.v1"}\n', "utf8"),
					stderr: "",
				}),
				objectStore,
			}),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"expected schema_version document_units_validation_report.v1",
		);
		expect(
			[...objectStore.objects.keys()].filter((key) => key.startsWith("ingestion-kernels/")),
		).toHaveLength(0);
	});

	it("fails closed when a kernel reports validation errors in a zero-exit stdout contract", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, '{"bad":true}\n');

		const result = await runDeclaredTaskForTest({
			store,
			registry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				commandRunner: async () => ({
					exitCode: 0,
					signal: null,
					stdout: Buffer.from(
						`${JSON.stringify({
							schema_version: "document_units_validation_report.v1",
							unit_count: 1,
							error_count: 1,
							errors: ["line 1 doc_id is required"],
						})}\n`,
						"utf8",
					),
					stderr: "",
				}),
				objectStore,
			}),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task.closeout?.error?.code).toBe("ingestion_task_execution_failed");
		expect(result.task.closeout?.error?.message).toContain(
			"ingestion kernel validate-document-units reported 1 validation error",
		);
		expect(
			[...objectStore.objects.keys()].filter((key) => key.startsWith("ingestion-kernels/")),
		).toHaveLength(0);
	});
});

class InMemoryObjectStore {
	readonly bucket: string;
	readonly objects = new Map<string, Uint8Array>();

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const value = this.objects.get(input.key);
		if (!value) {
			throw new Error(`missing object: ${input.key}`);
		}
		return value;
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		if (input.contentType !== "application/json") {
			throw new Error(`unexpected content type: ${input.contentType}`);
		}
		this.objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256(input.body),
		};
	}

	putText(key: string, value: string): void {
		this.objects.set(key, Buffer.from(value, "utf8"));
	}

	getRequiredObjectFromUri(uri: string): Uint8Array {
		const prefix = `s3://${this.bucket}/`;
		if (!uri.startsWith(prefix)) {
			throw new Error(`unexpected uri: ${uri}`);
		}
		const value = this.objects.get(uri.slice(prefix.length));
		if (!value) {
			throw new Error(`missing uri object: ${uri}`);
		}
		return value;
	}
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function requiredString(value: string | undefined): string {
	if (!value) {
		throw new Error("expected string");
	}
	return value;
}

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	createDefaultRustKernelRegistry,
	type IngestionTaskEnvelope,
	type IngestionTaskRegistry,
	InMemoryIngestionTaskStore,
	type RustKernelCommandRunner,
	runRegistryTaskOnce,
	TsTaskHandlerRegistry,
} from "../src/index.ts";

const inputKey = "canonical-document-units/student-rules.jsonl";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_student_rules_document_units_validate_001",
	run_id: "run_student_rules_20260630",
	source_family: "regulations",
	source_channel: "student_rules",
	corpus: "regulations",
	collection: "student_rules",
	task_kind: "document_units_validate",
	input_ref: {
		kind: "object_store",
		uri: `s3://campus-agent-source/${inputKey}`,
	},
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 1,
	},
	created_by: "operator",
	created_at: "2026-06-30T00:00:00Z",
};

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v1",
	source_family: "regulations",
	corpus: "regulations",
	collection: "student_rules",
	tasks: [
		{
			task_kind: "document_units_validate",
			executor_kind: "rust_kernel",
			kernel_id: "validate-document-units",
			input_contract: "canonical_document_units.v1",
			output_contract: "document_units_validation_report.v1",
			can_publish_alias: false,
		},
	],
};

describe("Rust ingestion kernel runner bridge", () => {
	it("runs the declared Rust kernel binary bridge and stores its JSON artifact", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(
			inputKey,
			'{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}\n',
		);
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

		const result = await runRegistryTaskOnce({
			store,
			registry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				commandRunner,
				objectStore,
				runnerPath: "/usr/local/bin/ingestion-kernel-runner",
			}),
			workerId: "rust-kernel-worker-a",
		});

		expect(result.status).toBe("completed");
		expect(runnerCalls).toHaveLength(1);
		expect(runnerCalls[0]).toMatchObject({
			executable: "/usr/local/bin/ingestion-kernel-runner",
			args: ["validate-document-units"],
		});
		expect(Buffer.from(runnerCalls[0].stdin).toString("utf8")).toBe(
			'{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}\n',
		);
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

	it("passes chunk sizing to the chunk-document-units kernel", async () => {
		const chunkTask: IngestionTaskEnvelope = {
			...task,
			task_id: "task_student_rules_chunk_prepare_001",
			task_kind: "chunk_prepare",
			output_contract: "ingestion_chunk_set.v1",
			idempotency_key: "regulations/student_rules/chunk_prepare/release-001",
		};
		const chunkRegistry: IngestionTaskRegistry = {
			...registry,
			tasks: [
				{
					task_kind: "chunk_prepare",
					executor_kind: "rust_kernel",
					kernel_id: "chunk-document-units",
					input_contract: "canonical_document_units.v1",
					output_contract: "ingestion_chunk_set.v1",
					can_publish_alias: false,
				},
			],
		};
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(chunkTask);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(
			inputKey,
			'{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}\n',
		);
		const runnerCalls: Parameters<RustKernelCommandRunner>[0][] = [];

		const result = await runRegistryTaskOnce({
			store,
			registry: chunkRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: createDefaultRustKernelRegistry({
				chunkMaxChars: 128,
				commandRunner: async (input) => {
					runnerCalls.push(input);
					return {
						exitCode: 0,
						signal: null,
						stdout: Buffer.from(
							`${JSON.stringify({
								schema_version: "ingestion_chunk_set.v1",
								chunk_count: 1,
								chunks: [],
								error_count: 0,
								errors: [],
							})}\n`,
							"utf8",
						),
						stderr: "",
					};
				},
				objectStore,
			}),
			workerId: "rust-kernel-worker-a",
		});

		expect(result.status).toBe("completed");
		expect(runnerCalls[0].args).toEqual(["chunk-document-units", "--max-chars", "128"]);
	});

	it("fails closed when the runner exits non-zero", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-30T00:00:00Z"),
		});
		store.admitTask(task);
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		objectStore.putText(inputKey, '{"bad":true}\n');

		const result = await runRegistryTaskOnce({
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
			workerId: "rust-kernel-worker-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("task_executor_failed");
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

		const result = await runRegistryTaskOnce({
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
			workerId: "rust-kernel-worker-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("task_executor_failed");
		expect(result.task?.closeout?.error?.message).toContain(
			"expected schema_version document_units_validation_report.v1",
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

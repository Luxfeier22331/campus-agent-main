import type { IngestionTaskEnvelope } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	buildIngestionKernelArtifactKey,
	INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE,
	parseIngestionKernelJsonOutput,
} from "../src/index.ts";

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
		uri: "s3://campus-agent-source/canonical-document-units/student-rules.jsonl",
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
	created_by: "operator",
	created_at: "2026-06-30T00:00:00Z",
};

describe("ingestion kernel artifacts", () => {
	it("builds deterministic kernel artifact keys without app-level helpers", () => {
		expect(
			buildIngestionKernelArtifactKey({
				kernelId: "validate-document-units",
				task,
			}),
		).toBe(
			"ingestion-kernels/regulations/student_rules/run_student_rules_20260630/task_student_rules_document_units_validate_001/validate-document-units.json",
		);
		expect(INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE).toBe("application/json");
	});

	it("parses kernel JSON output and enforces the task output contract", () => {
		const output = parseIngestionKernelJsonOutput({
			expectedSchemaVersion: "document_units_validation_report.v1",
			kernelId: "validate-document-units",
			stdout: new TextEncoder().encode(
				'{"schema_version":"document_units_validation_report.v1","unit_count":1,"error_count":0,"errors":[]}\n',
			),
		});

		expect(new TextDecoder().decode(output.bytes)).toBe(
			'{"schema_version":"document_units_validation_report.v1","unit_count":1,"error_count":0,"errors":[]}\n',
		);
		expect(output.value).toEqual({
			schema_version: "document_units_validation_report.v1",
			unit_count: 1,
			error_count: 0,
			errors: [],
		});
	});

	it("fails closed when kernel output is missing required contract fields", () => {
		expect(() =>
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "document_units_validation_report.v1",
				kernelId: "validate-document-units",
				stdout: new TextEncoder().encode(
					'{"schema_version":"document_units_validation_report.v1","error_count":0,"errors":[]}\n',
				),
			}),
		).toThrow("unit_count");

		expect(() =>
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "ingestion_chunk_set.v1",
				kernelId: "chunk-document-units",
				stdout: new TextEncoder().encode(
					'{"schema_version":"ingestion_chunk_set.v1","chunk_count":1,"chunks":[],"error_count":0,"errors":[]}\n',
				),
			}),
		).toThrow("chunk_count must match chunks length");
	});

	it("requires chunk output to use doc_id instead of legacy document_id", () => {
		expect(() =>
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "ingestion_chunk_set.v1",
				kernelId: "chunk-document-units",
				stdout: new TextEncoder().encode(
					'{"schema_version":"ingestion_chunk_set.v1","chunk_count":1,"chunks":[{"chunk_id":"chunk-1","document_id":"doc-1","unit_ids":["unit-1"],"text":"hello"}],"error_count":0,"errors":[]}\n',
				),
			}),
		).toThrow("doc_id");

		expect(
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "ingestion_chunk_set.v1",
				kernelId: "chunk-document-units",
				stdout: new TextEncoder().encode(
					'{"schema_version":"ingestion_chunk_set.v1","chunk_count":1,"chunks":[{"chunk_id":"chunk-1","doc_id":"doc-1","unit_ids":["unit-1"],"text":"hello"}],"error_count":0,"errors":[]}\n',
				),
			}).value,
		).toMatchObject({
			chunks: [{ chunk_id: "chunk-1", doc_id: "doc-1", unit_ids: ["unit-1"] }],
		});
	});

	it("fails closed on invalid key segments and invalid kernel output", () => {
		expect(() =>
			buildIngestionKernelArtifactKey({
				kernelId: "../bad",
				task,
			}),
		).toThrow("kernel_id is not safe for ingestion kernel artifact key");

		expect(() =>
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "document_units_validation_report.v1",
				kernelId: "validate-document-units",
				stdout: new TextEncoder().encode('{"schema_version":"wrong.v1"}\n'),
			}),
		).toThrow("expected schema_version document_units_validation_report.v1");

		expect(() =>
			parseIngestionKernelJsonOutput({
				expectedSchemaVersion: "document_units_validation_report.v1",
				kernelId: "validate-document-units",
				stdout: new TextEncoder().encode("[]\n"),
			}),
		).toThrow("stdout must be a JSON object");
	});
});

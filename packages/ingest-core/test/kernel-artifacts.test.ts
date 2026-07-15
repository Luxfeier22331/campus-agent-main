import type { IngestionTaskEnvelope } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	assertIngestionKernelOutputSucceeded,
	buildIngestionKernelArtifactKey,
	INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE,
	IngestionKernelReportedErrorsError,
	parseIngestionKernelJsonOutput,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v3",
	task_id: "task_student_rules_document_units_validate_001",
	run_id: "run_student_rules_20260630",
	registry_task_id: "regulations.student_rules.document_units_validate",
	input_ref: {
		byte_size: 1,
		kind: "object_store",
		uri: "s3://campus-agent-source/canonical-document-units/student-rules.jsonl",
		digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
	},
};

describe("ingestion kernel artifacts", () => {
	it("builds deterministic kernel artifact keys without app-level helpers", () => {
		expect(
			buildIngestionKernelArtifactKey({
				activityAttempt: 2,
				kernelId: "validate-document-units",
				task,
			}),
		).toBe(
			"ingestion-kernels/regulations.student_rules.document_units_validate/runs/run_student_rules_20260630/attempts/2/task_student_rules_document_units_validate_001/validate-document-units.json",
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
		expect(output.errorCount).toBe(0);
		expect(output.errors).toEqual([]);
		expect(() =>
			assertIngestionKernelOutputSucceeded({
				errorCount: output.errorCount,
				errors: output.errors,
				kernelId: "validate-document-units",
			}),
		).not.toThrow();
	});

	it("classifies kernel-reported validation errors as failed execution results", () => {
		const output = parseIngestionKernelJsonOutput({
			expectedSchemaVersion: "document_units_validation_report.v1",
			kernelId: "validate-document-units",
			stdout: new TextEncoder().encode(
				'{"schema_version":"document_units_validation_report.v1","unit_count":1,"error_count":1,"errors":["line 1 doc_id is required"]}\n',
			),
		});

		expect(output.errorCount).toBe(1);
		expect(output.errors).toEqual(["line 1 doc_id is required"]);
		expect(() =>
			assertIngestionKernelOutputSucceeded({
				errorCount: output.errorCount,
				errors: output.errors,
				kernelId: "validate-document-units",
			}),
		).toThrow(IngestionKernelReportedErrorsError);
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

	it("reversibly encodes key segments and fails closed on invalid kernel output", () => {
		expect(
			buildIngestionKernelArtifactKey({
				activityAttempt: 1,
				kernelId: "../bad",
				task,
			}),
		).toContain("..%2Fbad.json");
		expect(() =>
			buildIngestionKernelArtifactKey({
				activityAttempt: 0,
				kernelId: "validate-document-units",
				task,
			}),
		).toThrow("activityAttempt must be a positive integer");

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

import type { IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	auditIngestionRegistryExecutability,
	classifyIngestionRegistryTaskExecutability,
	DEFAULT_EXECUTABLE_RUST_KERNEL_IDS,
	DEFAULT_EXECUTABLE_RUST_KERNELS,
	DEFAULT_EXECUTABLE_TS_TASK_IDENTITIES,
	DEFAULT_EXECUTABLE_TS_TASKS,
	isDefaultRustKernelExecutable,
	isDefaultTsTaskExecutable,
} from "../src/index.ts";

const registry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	tasks: [
		{
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
		},
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

describe("ingestion task executability facts", () => {
	it("exposes default executable TS handler identities from ingest-core", () => {
		expect(
			DEFAULT_EXECUTABLE_TS_TASK_IDENTITIES.map(
				(identity) =>
					`${identity.sourceFamily}/${identity.corpus}/${identity.collection}/${identity.registryTaskId}`,
			),
		).toEqual([
			"authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
			"authenticated_notice/authenticated_documents/file_release_source/source_truth_materialize",
			"official_web/official_web/fresh_news/source_truth_materialize",
			"official_web/official_web/stable_reference/source_truth_materialize",
			"wechat_public_notice/campus_notices/wechat_public_notice/source_truth_materialize",
		]);
		expect(
			isDefaultTsTaskExecutable({
				sourceFamily: "official_web",
				corpus: "official_web",
				collection: "stable_reference",
				registryTaskId: "source_truth_materialize",
			}),
		).toBe(true);
		expect(DEFAULT_EXECUTABLE_TS_TASKS[0]).toMatchObject({
			inputContract: "authenticated_notice_capture_release.v1",
			outputContract: "authenticated_notice_source_truth.v1",
		});
	});

	it("exposes default executable Rust kernel ids from ingest-core", () => {
		expect(DEFAULT_EXECUTABLE_RUST_KERNEL_IDS).toEqual([
			"chunk-document-units",
			"validate-document-units",
			"validate-release-manifest",
		]);
		expect(isDefaultRustKernelExecutable("chunk-document-units")).toBe(true);
		expect(isDefaultRustKernelExecutable("unknown-kernel")).toBe(false);
		expect(DEFAULT_EXECUTABLE_RUST_KERNELS[0]).toEqual({
			kernelId: "chunk-document-units",
			inputContract: "canonical_document_units.v1",
			outputContract: "ingestion_chunk_set.v1",
		});
	});

	it("classifies registry-declared tasks with the default executability facts", () => {
		expect(
			registry.tasks.map((task) =>
				classifyIngestionRegistryTaskExecutability({
					registry,
					task,
				}),
			),
		).toEqual([
			{
				identity: "official_web/official_web/stable_reference/source_truth_materialize",
				executorKind: "ts_control",
				status: "executable",
			},
			{
				identity: "rust_kernel:chunk-document-units",
				executorKind: "rust_kernel",
				status: "executable",
			},
		]);
	});

	it("audits registry-declared task executability inside ingest-core", () => {
		expect(auditIngestionRegistryExecutability([registry])).toEqual([]);
		expect(
			auditIngestionRegistryExecutability([
				{
					...registry,
					tasks: [
						{
							registry_task_id: "custom_read_model",
							task_kind: "source_truth_materialize",
							executor_kind: "ts_control",
							input_contract: "notice_projection.v1",
							output_contract: "notice_read_model.v1",
						},
						{
							registry_task_id: "release_manifest_validate",
							task_kind: "release_manifest_validate",
							executor_kind: "rust_kernel",
							input_contract: "ingestion_release_manifest.v1",
							output_contract: "ingestion_release_manifest_validation_report.v1",
						},
						{
							registry_task_id: "release_manifest_validate_unknown",
							task_kind: "release_manifest_validate",
							executor_kind: "rust_kernel",
							kernel_id: "unknown-kernel",
							input_contract: "ingestion_release_manifest.v1",
							output_contract: "ingestion_release_manifest_validation_report.v1",
						},
					],
				},
			]),
		).toEqual([
			{
				identity: "official_web/official_web/stable_reference/custom_read_model",
				executorKind: "ts_control",
				status: "invalid_registry",
				message: "registry-declared ts_control task has no default handler",
			},
			{
				identity: "official_web/official_web/stable_reference/release_manifest_validate",
				executorKind: "rust_kernel",
				status: "invalid_registry",
				message: "registry-declared rust_kernel task is missing kernel_id",
			},
			{
				identity: "rust_kernel:unknown-kernel",
				executorKind: "rust_kernel",
				status: "invalid_registry",
				message: "registry-declared rust_kernel task has no default kernel bridge",
			},
		]);
	});

	it("rejects registry tasks whose contracts do not match default executor inventory", () => {
		expect(
			auditIngestionRegistryExecutability([
				{
					...registry,
					tasks: [
						{
							registry_task_id: "source_truth_materialize",
							task_kind: "source_truth_materialize",
							executor_kind: "ts_control",
							input_contract: "wrong_input.v1",
							output_contract: "official_web_stable_reference_source_truth.v1",
						},
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "wrong_output.v1",
						},
					],
				},
			]),
		).toEqual([
			{
				identity: "official_web/official_web/stable_reference/source_truth_materialize",
				executorKind: "ts_control",
				status: "invalid_registry",
				message: "registry-declared ts_control task contract does not match default handler",
			},
			{
				identity: "rust_kernel:chunk-document-units",
				executorKind: "rust_kernel",
				status: "invalid_registry",
				message: "registry-declared rust_kernel task contract does not match default kernel bridge",
			},
		]);
	});
});

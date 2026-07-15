import type { IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	auditIngestionRegistryExecutability,
	DEFAULT_EXECUTABLE_RUST_KERNEL_IDS,
	DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASK_IDS,
	isDefaultRustKernelExecutable,
	isDefaultSourceCollectorExecutable,
} from "../src/index.ts";

describe("ingestion task executability facts", () => {
	it("declares every source collector task", () => {
		expect(DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASK_IDS).toEqual([
			"official_web.capture",
			"internal_portal.notice.capture",
			"internal_portal.file_release.capture",
			"wechat_official_account.capture",
		]);
		expect(isDefaultSourceCollectorExecutable("official_web.capture")).toBe(true);
	});

	it("declares the deterministic Rust kernels", () => {
		expect(DEFAULT_EXECUTABLE_RUST_KERNEL_IDS).toEqual([
			"chunk-document-units",
			"validate-document-units",
			"validate-release-manifest",
		]);
		expect(isDefaultRustKernelExecutable("chunk-document-units")).toBe(true);
	});

	it("rejects handlers and contract drift", () => {
		const registry: IngestionTaskRegistry = {
			schema_version: "ingestion_task_registry.v3",
			tasks: [
				{
					registry_task_id: "unknown.capture",
					executor_kind: "source_collector",
					input_contract: "unknown_request.v1",
					output_contract: "unknown_manifest.v1",
					source: { family: "unknown", channel: "unknown" },
				},
				{
					registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
					executor_kind: "rust_kernel",
					kernel_id: "chunk-document-units",
					input_contract: "wrong.v1",
					output_contract: "ingestion_chunk_set.v1",
					target: { corpus: "curriculum", collection: "curriculum_plan" },
				},
			],
		};
		expect(auditIngestionRegistryExecutability([registry])).toEqual([
			expect.objectContaining({ identity: "unknown.capture", status: "invalid_registry" }),
			expect.objectContaining({
				identity: "rust_kernel:chunk-document-units",
				status: "invalid_registry",
			}),
		]);
	});
});

import type { IngestionTaskRegistry } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import {
	auditIngestionRegistryExecutability,
	DEFAULT_EXECUTABLE_RUST_KERNEL_IDS,
	isDefaultRustKernelExecutable,
} from "../src/index.ts";

describe("ingestion task executability facts", () => {
	it("declares the deterministic Rust kernels", () => {
		expect(DEFAULT_EXECUTABLE_RUST_KERNEL_IDS).toEqual([
			"build-retrieval-chunks-v2",
			"validate-document-units",
		]);
		expect(isDefaultRustKernelExecutable("build-retrieval-chunks-v2")).toBe(true);
	});

	it("rejects handlers and contract drift", () => {
		const registry: IngestionTaskRegistry = {
			schema_version: "ingestion_task_registry.v3",
			tasks: [
				{
					registry_task_id: "curriculum.curriculum_plan.unknown",
					executor_kind: "rust_kernel",
					kernel_id: "unknown-kernel",
					input_contract: "canonical_document_units.v1",
					output_contract: "ingestion_chunk_set.v1",
					target: { corpus: "curriculum", collection: "curriculum_plan" },
				},
				{
					registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
					executor_kind: "rust_kernel",
					kernel_id: "build-retrieval-chunks-v2",
					input_contract: "wrong.v1",
					output_contract: "retrieval_chunk_set.v2",
					target: { corpus: "curriculum", collection: "curriculum_plan" },
				},
			],
		};
		expect(auditIngestionRegistryExecutability([registry])).toEqual([
			expect.objectContaining({
				identity: "rust_kernel:unknown-kernel",
				status: "invalid_registry",
			}),
			expect.objectContaining({
				identity: "rust_kernel:build-retrieval-chunks-v2",
				status: "invalid_registry",
			}),
		]);
	});
});

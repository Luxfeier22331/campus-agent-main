// @vitest-environment node

import { describe, expect, it } from "vitest";

import { runHindsightMemoryE2eStaging } from "../scripts/hindsight-memory-e2e-staging";

function jsonResponse(payload: unknown, status = 202): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
		status,
	});
}

describe("Hindsight memory staging e2e runner", () => {
	it("proves append materialization, operation list, recall, reflect, and cleanup through sanitized internal endpoints", async () => {
		const calls: Array<{ body?: unknown; headers: Record<string, string>; url: string }> = [];
		const result = await runHindsightMemoryE2eStaging(
			["--run-id", "run-memory-e2e", "--user-id", "user-memory-e2e"],
			{
				EXECUTION_CONTROL_SHARED_SECRET: "worker-secret",
				STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
			} as NodeJS.ProcessEnv,
			{
				now: () => new Date("2026-06-30T01:02:03.000Z"),
				async fetchJson(input) {
					calls.push({
						body: input.body,
						headers: input.headers,
						url: input.url,
					});
					if (input.url.endsWith("/internal/memory/personal/turns:append")) {
						return jsonResponse({
							appended_message_count: 1,
							operation_id: "op-retain-001",
							operation_status_ref:
								"projection://runs/run-memory-e2e/memory/operations/op-retain-001",
							payload_sha256: "append-hash",
							runtime_document_ref:
								"projection://runs/run-memory-e2e/memory/documents/conversation",
							run_id: "run-memory-e2e",
							schema_version: "memory_conversation_append_result_v1",
							status: "accepted",
							thread_id: "thread-run-memory-e2e",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/operations:status")) {
						return jsonResponse({
							operation_id: "op-retain-001",
							operation_ref: "projection://runs/run-memory-e2e/memory/operations/op-retain-001",
							payload_sha256: "operation-status-hash",
							run_id: "run-memory-e2e",
							schema_version: "memory_operation_status_result_v1",
							status: "completed",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/operations:list")) {
						return jsonResponse({
							limit: 10,
							offset: 0,
							operations: [
								{
									operation_id: "op-retain-001",
									operation_ref: "projection://runs/run-memory-e2e/memory/operations/op-retain-001",
									operation_type: "retain",
									status: "completed",
								},
							],
							payload_sha256: "operation-list-hash",
							run_id: "run-memory-e2e",
							schema_version: "memory_operation_list_result_v1",
							total: 1,
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/graph:recall")) {
						if (
							typeof input.body === "object" &&
							input.body !== null &&
							"user_id" in input.body &&
							input.body.user_id === "user-memory-e2e-isolation"
						) {
							return jsonResponse({
								context_block: "",
								memory_context_items: [],
								memory_ref: "projection://runs/run-memory-e2e/memory/recall-isolation",
								payload_sha256: "isolation-recall-hash",
								schema_version: "memory_recall_result_v1",
								selected_memory_chars: 0,
								selected_memory_count: 0,
								status: "completed",
								user_id: "user-memory-e2e-isolation",
							});
						}
						return jsonResponse({
							context_block: "用户关注保研材料准备。",
							memory_context_items: [
								{
									compact_text: "用户关注保研材料准备。",
									memory_id: "projection://runs/run-memory-e2e/memory/items/1",
									memory_type: "experience",
									tool: "hindsight",
									updated_at: "2026-06-30T01:02:03.000Z",
								},
							],
							memory_ref: "projection://runs/run-memory-e2e/memory/recall",
							payload_sha256: "recall-hash",
							schema_version: "memory_recall_result_v1",
							selected_memory_chars: 12,
							selected_memory_count: 1,
							status: "completed",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/graph:reflect")) {
						return jsonResponse({
							based_on_memory_context_items: [
								{
									compact_text: "用户关注保研材料准备。",
									memory_id: "projection://runs/run-memory-e2e/memory/items/1",
									memory_type: "experience",
									tool: "hindsight",
									updated_at: "2026-06-30T01:02:03.000Z",
								},
							],
							payload_sha256: "reflect-hash",
							reflect_ref: "projection://runs/run-memory-e2e/memory/reflect",
							run_id: "run-memory-e2e",
							schema_version: "memory_reflect_result_v1",
							status: "completed",
							text: "用户近期关注保研材料准备。",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/items:upsert")) {
						return jsonResponse({
							episode_uuid: "profile:smoke_memory_probe",
							memory_id: "smoke_memory_probe",
							payload_sha256: "profile-upsert-hash",
							schema_version: "memory_profile_item_result_v1",
							status: "accepted",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/items:disable")) {
						return jsonResponse({
							memory_id: "smoke_memory_probe",
							payload_sha256: "profile-disable-hash",
							schema_version: "memory_profile_item_result_v1",
							status: "disabled",
							user_id: "user-memory-e2e",
						});
					}
					if (input.url.endsWith("/internal/memory/personal/owner:disable")) {
						return jsonResponse({
							payload_sha256: "owner-disable-hash",
							schema_version: "memory_profile_owner_result_v1",
							status: "disabled",
							user_id: "user-memory-e2e",
						});
					}
					throw new Error(`unexpected request: ${input.url}`);
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.append.operationId).toBe("op-retain-001");
		expect(result.operationStatus.status).toBe("completed");
		expect(result.operationList.total).toBe(1);
		expect(result.recall.selectedMemoryCount).toBe(1);
		expect(result.isolation.selectedMemoryCount).toBe(0);
		expect(result.reflect.basedOnCount).toBe(1);
		expect(result.cleanup.ownerDisabled).toBe(true);
		expect(calls.map((call) => call.url)).toEqual([
			"https://execution-control.example.com/internal/memory/personal/turns:append",
			"https://execution-control.example.com/internal/memory/personal/operations:status",
			"https://execution-control.example.com/internal/memory/personal/operations:list",
			"https://execution-control.example.com/internal/memory/personal/graph:recall",
			"https://execution-control.example.com/internal/memory/personal/graph:recall",
			"https://execution-control.example.com/internal/memory/personal/graph:reflect",
			"https://execution-control.example.com/internal/memory/personal/items:upsert",
			"https://execution-control.example.com/internal/memory/personal/items:disable",
			"https://execution-control.example.com/internal/memory/personal/owner:disable",
		]);
		expect(calls.every((call) => call.headers["x-worker-origin-auth"] === "worker-secret")).toBe(
			true,
		);
	});

	it("rejects responses that expose Hindsight raw identifiers or payloads", async () => {
		await expect(
			runHindsightMemoryE2eStaging(
				[],
				{
					EXECUTION_CONTROL_SHARED_SECRET: "worker-secret",
					STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
				} as NodeJS.ProcessEnv,
				{
					async fetchJson(input) {
						if (input.url.endsWith("/internal/memory/personal/turns:append")) {
							return jsonResponse({
								appended_message_count: 1,
								bank_id: "hindsight_bank_hidden",
								operation_id: "op-retain-001",
								payload_sha256: "append-hash",
								run_id: "run-hindsight-memory-smoke",
								schema_version: "memory_conversation_append_result_v1",
								status: "accepted",
								thread_id: "thread-hindsight-memory-smoke",
								user_id: "hindsight-memory-smoke",
							});
						}
						throw new Error(`unexpected request: ${input.url}`);
					},
				},
			),
		).rejects.toThrow("forbidden Hindsight memory field");
	});
});

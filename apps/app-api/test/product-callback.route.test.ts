// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ProfileMemoryService } from "../src/modules/profile-memory";
import type { ChatCommandService } from "../src/modules/runtime-command";
import { ChatFinalizationConflict } from "../src/modules/runtime-command/store-types";
import { createTelemetryMock } from "./chat-command.service.test-support";

const callbackSecret = "product-callback-secret";

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function finalizationResponse() {
	return {
		answer_text: "Answer",
		confidence: "medium",
		error: null,
		follow_up_question: "",
		observability: null,
		resolved_targets: [],
		result: null,
		selected_tool: null,
		session_update: null,
		status: "completed",
		trace_id: "trace_1",
		workflow_trace_summary: null,
	};
}

function appWithCallbacks(input: {
	applyMemoryResult?: ProfileMemoryService["applyResult"];
	applyProductFinalization?: NonNullable<ChatCommandService["applyProductFinalization"]>;
}) {
	return createApp(
		{ APP_API_EXECUTION_SHARED_SECRET: callbackSecret },
		{
			chatCommandService: {
				applyProductFinalization:
					input.applyProductFinalization ?? vi.fn(async () => ({ outcome: "applied" as const })),
				submit: vi.fn(),
			},
			profileMemoryService: {
				applyResult: input.applyMemoryResult ?? vi.fn(async () => "applied" as const),
			} as unknown as ProfileMemoryService,
			telemetry: createTelemetryMock(),
		},
	);
}

describe("product callback routes", () => {
	it("validates and applies a chat finalization fingerprint", async () => {
		const applyProductFinalization = vi.fn(async () => ({ outcome: "applied" as const }));
		const app = appWithCallbacks({ applyProductFinalization });
		const runId = "run_1";
		const response = finalizationResponse();
		const fingerprint = sha256(`${runId}\0${JSON.stringify(response)}`);

		const result = await app.request(`/api/internal/execution/runs/${runId}/product-finalization`, {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: fingerprint,
				response,
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});

		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ outcome: "applied" });
		expect(applyProductFinalization).toHaveBeenCalledWith(
			expect.objectContaining({ finalizationFingerprint: fingerprint, runId }),
		);
	});

	it("rejects a changed chat result and maps recorded fingerprint conflicts", async () => {
		const applyProductFinalization = vi.fn(async () => {
			throw new ChatFinalizationConflict();
		});
		const app = appWithCallbacks({ applyProductFinalization });
		const response = finalizationResponse();
		const invalid = await app.request("/api/internal/execution/runs/run_1/product-finalization", {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: "changed",
				response,
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});
		expect(invalid.status).toBe(400);
		expect(applyProductFinalization).not.toHaveBeenCalled();

		const fingerprint = sha256(`run_1\0${JSON.stringify(response)}`);
		const conflict = await app.request("/api/internal/execution/runs/run_1/product-finalization", {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: fingerprint,
				response,
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});
		expect(conflict.status).toBe(409);
	});

	it("accepts replayed or superseded memory results with deterministic fingerprints", async () => {
		const applyMemoryResult = vi.fn(async () => "superseded" as const);
		const app = appWithCallbacks({ applyMemoryResult });
		const commandId = "memcmd_1";
		const fingerprint = sha256(`${commandId}\0succeeded\0`);

		const result = await app.request(`/api/internal/profile-memory/commands/${commandId}/result`, {
			body: JSON.stringify({
				error_code: "",
				result_fingerprint: fingerprint,
				status: "succeeded",
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});

		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ outcome: "superseded" });
		expect(applyMemoryResult).toHaveBeenCalledWith({
			commandId,
			resultFingerprint: fingerprint,
			status: "succeeded",
		});
	});
});

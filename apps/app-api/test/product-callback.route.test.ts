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
		model_usage: {
			cached_input_tokens: 10,
			input_tokens: 120,
			output_tokens: 42,
			total_tokens: 162,
		},
		observability: null,
		result: null,
		status: "completed",
		trace_id: "trace_1",
		workflow_trace_summary: null,
	};
}

function goEscapedFinalizationResponseJson(): string {
	return JSON.stringify({
		...finalizationResponse(),
		answer_text: "escaped <>&\u2028\u2029",
		result: { nested: { count: 7.25 } },
	})
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function appWithCallbacks(input: {
	applyMemoryResult?: ProfileMemoryService["applyResult"];
	applyProductFinalization?: NonNullable<ChatCommandService["applyProductFinalization"]>;
}) {
	return createApp(
		{
			DEPLOYMENT_ENVIRONMENT: "test",
			APP_API_EXECUTION_SHARED_SECRET: callbackSecret,
		},
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
	it("validates exact Go response JSON bytes before applying a chat finalization", async () => {
		const applyProductFinalization = vi.fn(async () => ({ outcome: "applied" as const }));
		const app = appWithCallbacks({ applyProductFinalization });
		const runId = "run_1";
		const responseJson = goEscapedFinalizationResponseJson();
		expect(responseJson).toContain("\\u003c\\u003e\\u0026\\u2028\\u2029");
		const fingerprint = sha256(`${runId}\0${responseJson}`);

		const result = await app.request(`/api/internal/execution/runs/${runId}/product-finalization`, {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: fingerprint,
				response_json: responseJson,
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
			expect.objectContaining({
				finalizationFingerprint: fingerprint,
				response: expect.objectContaining({
					answerText: "escaped <>&\u2028\u2029",
					result: { nested: { count: 7.25 } },
				}),
				runId,
			}),
		);
	});

	it("rejects a fingerprint computed from parsed and reserialized response JSON", async () => {
		const applyProductFinalization = vi.fn(async () => ({ outcome: "applied" as const }));
		const app = appWithCallbacks({ applyProductFinalization });
		const runId = "run_1";
		const responseJson = goEscapedFinalizationResponseJson();
		const reserialized = JSON.stringify(JSON.parse(responseJson));
		expect(reserialized).not.toBe(responseJson);

		const result = await app.request(`/api/internal/execution/runs/${runId}/product-finalization`, {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: sha256(`${runId}\0${reserialized}`),
				response_json: responseJson,
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});

		expect(result.status).toBe(400);
		expect(applyProductFinalization).not.toHaveBeenCalled();
	});

	it("rejects old-only and mixed payloads containing the retired response field", async () => {
		const applyProductFinalization = vi.fn(async () => ({ outcome: "applied" as const }));
		const app = appWithCallbacks({ applyProductFinalization });
		const response = finalizationResponse();
		const runId = "run_1";
		const responseJson = JSON.stringify(response);
		const sharedFields = {
			completed_at: "2026-07-15T08:00:00.000Z",
			finalization_fingerprint: sha256(`${runId}\0${responseJson}`),
		};

		for (const body of [
			{
				...sharedFields,
				response,
			},
			{
				...sharedFields,
				response,
				response_json: responseJson,
			},
		]) {
			const result = await app.request(
				`/api/internal/execution/runs/${runId}/product-finalization`,
				{
					body: JSON.stringify(body),
					headers: {
						"content-type": "application/json",
						"x-app-product-callback-auth": callbackSecret,
					},
					method: "PUT",
				},
			);

			expect(result.status).toBe(400);
		}
		expect(applyProductFinalization).not.toHaveBeenCalled();
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
				response_json: JSON.stringify(response),
			}),
			headers: {
				"content-type": "application/json",
				"x-app-product-callback-auth": callbackSecret,
			},
			method: "PUT",
		});
		expect(invalid.status).toBe(400);
		expect(applyProductFinalization).not.toHaveBeenCalled();

		const responseJson = JSON.stringify(response);
		const fingerprint = sha256(`run_1\0${responseJson}`);
		const conflict = await app.request("/api/internal/execution/runs/run_1/product-finalization", {
			body: JSON.stringify({
				completed_at: "2026-07-15T08:00:00.000Z",
				finalization_fingerprint: fingerprint,
				response_json: responseJson,
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

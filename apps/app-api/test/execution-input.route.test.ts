// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ChatCommandService } from "../src/modules/runtime-command";
import { createTelemetryMock } from "./chat-command.service.test-support";

const callbackSecret = "product-callback-secret";
const executionInputSecret = "execution-input-secret";

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function appWithExecutionInput(input: {
	readExecutionInput?: NonNullable<ChatCommandService["readExecutionInput"]>;
	releaseExecutionInput?: NonNullable<ChatCommandService["releaseExecutionInput"]>;
}) {
	return createApp(
		{
			APP_API_EXECUTION_INPUT_SHARED_SECRET: executionInputSecret,
			APP_API_EXECUTION_SHARED_SECRET: callbackSecret,
		},
		{
			chatCommandService: {
				readExecutionInput: input.readExecutionInput ?? vi.fn(async () => null),
				releaseExecutionInput:
					input.releaseExecutionInput ?? vi.fn(async () => "released" as const),
				submit: vi.fn(),
			},
			telemetry: createTelemetryMock(),
		},
	);
}

describe("execution input routes", () => {
	it("returns the exact frozen bytes with independent auth and no-store", async () => {
		const executionInputJson = '{"z":1,"a":{"second":2,"first":1}}';
		const readExecutionInput = vi.fn(async () => ({
			executionInputJson,
			executionInputReleasedAt: null,
			executionInputSha256: sha256(executionInputJson),
			requestId: "req_1",
			runId: "run_1",
			status: "accepted" as const,
		}));
		const app = appWithExecutionInput({ readExecutionInput });

		const denied = await app.request("/api/internal/execution/runs/run_1/input", {
			headers: { "x-app-execution-auth": callbackSecret },
		});
		expect(denied.status).toBe(401);
		expect(denied.headers.get("cache-control")).toBe("no-store");

		const response = await app.request("/api/internal/execution/runs/run_1/input", {
			headers: { "x-app-execution-auth": executionInputSecret },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.text()).toBe(executionInputJson);
		expect(readExecutionInput).toHaveBeenCalledWith("run_1");
	});

	it("fails closed for absent, released, inconsistent, or oversized input", async () => {
		const oversized = `"${"x".repeat(1024 * 1024)}"`;
		const cases = [
			{ expected: 404, frozen: null },
			{
				expected: 404,
				frozen: {
					executionInputJson: null,
					executionInputReleasedAt: "2026-07-23T01:00:00.000Z",
					executionInputSha256: null,
					requestId: "req_1",
					runId: "run_1",
					status: "completed" as const,
				},
			},
			{
				expected: 409,
				frozen: {
					executionInputJson: "{}",
					executionInputReleasedAt: null,
					executionInputSha256: "0".repeat(64),
					requestId: "req_1",
					runId: "run_1",
					status: "accepted" as const,
				},
			},
			{
				expected: 409,
				frozen: {
					executionInputJson: oversized,
					executionInputReleasedAt: null,
					executionInputSha256: sha256(oversized),
					requestId: "req_1",
					runId: "run_1",
					status: "accepted" as const,
				},
			},
		];
		for (const testCase of cases) {
			const app = appWithExecutionInput({
				readExecutionInput: vi.fn(async () => testCase.frozen),
			});
			const response = await app.request("/api/internal/execution/runs/run_1/input", {
				headers: { "x-app-execution-auth": executionInputSecret },
			});
			expect(response.status).toBe(testCase.expected);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
	});

	it("releases terminal input idempotently and rejects pre-terminal release", async () => {
		const releaseExecutionInput = vi
			.fn()
			.mockResolvedValueOnce("not_terminal" as const)
			.mockResolvedValue("released" as const);
		const app = appWithExecutionInput({ releaseExecutionInput });
		const request = () =>
			app.request("/api/internal/execution/runs/run_1/input", {
				headers: { "x-app-execution-auth": executionInputSecret },
				method: "DELETE",
			});

		const pending = await request();
		expect(pending.status).toBe(409);
		expect(pending.headers.get("cache-control")).toBe("no-store");
		for (let replay = 0; replay < 2; replay += 1) {
			const released = await request();
			expect(released.status).toBe(204);
			expect(released.headers.get("cache-control")).toBe("no-store");
		}
	});
});

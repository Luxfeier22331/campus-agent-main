// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ChatCommandService } from "../src/modules/runtime-command";

const callbackSecret = "execution-shared-secret";
const executionInputSecret = callbackSecret;
const wrongExecutionSecret = "wrong-execution-secret";

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function appWithExecutionInput(input: {
	readExecutionInput?: NonNullable<ChatCommandService["readExecutionInput"]>;
}) {
	return createApp(
		{
			APP_API_INTERNAL_SHARED_SECRET: callbackSecret,
		},
		{
			chatCommandService: {
				readExecutionInput: input.readExecutionInput ?? vi.fn(async () => null),
				submit: vi.fn(),
			},
		},
	);
}

describe("execution input routes", () => {
	it("returns the exact frozen bytes with shared execution auth and no-store", async () => {
		const executionInputJson = '{"z":1,"a":{"second":2,"first":1}}';
		const readExecutionInput = vi.fn(async () => ({
			executionInputJson,
			executionInputSha256: sha256(executionInputJson),
		}));
		const app = appWithExecutionInput({ readExecutionInput });
		const historical = await app.request("/api/internal/execution/requests/req_1/input", {
			headers: { "x-app-execution-auth": executionInputSecret },
		});
		expect(historical.status).toBe(404);

		const denied = await app.request("/api/internal/agent/runs/req_1/input", {
			headers: { "x-app-execution-auth": wrongExecutionSecret },
		});
		expect(denied.status).toBe(401);
		expect(denied.headers.get("cache-control")).toBe("no-store");

		const response = await app.request("/api/internal/agent/runs/req_1/input", {
			headers: { "x-app-execution-auth": executionInputSecret },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.text()).toBe(executionInputJson);
		expect(readExecutionInput).toHaveBeenCalledWith("req_1");
	});

	it("fails closed for absent or oversized input", async () => {
		const oversized = `"${"x".repeat(1024 * 1024)}"`;
		const cases = [
			{ expected: 404, frozen: null },
			{
				expected: 409,
				frozen: {
					executionInputJson: oversized,
					executionInputSha256: sha256(oversized),
				},
			},
		];
		for (const testCase of cases) {
			const app = appWithExecutionInput({
				readExecutionInput: vi.fn(async () => testCase.frozen),
			});
			const response = await app.request("/api/internal/agent/runs/req_1/input", {
				headers: { "x-app-execution-auth": executionInputSecret },
			});
			expect(response.status).toBe(testCase.expected);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
	});
});

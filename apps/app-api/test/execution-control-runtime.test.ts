// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createExecutionControlRequester } from "../src/modules/integration/execution-control-runtime";

describe("execution control requester", () => {
	it("calls fetch without rebinding this", async () => {
		let observedThis: unknown = "not-called";
		const fetchImplementation = function (
			this: unknown,
			_input: RequestInfo | URL,
			_init?: RequestInit,
		): Promise<Response> {
			observedThis = this;
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			);
		};
		const requestExecutionControl = createExecutionControlRequester(
			{
				EXECUTION_CONTROL_BASE_URL: "http://execution-control.local",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
				EXECUTION_CONTROL_TIMEOUT_MS: "1000",
			},
			{
				fetchImplementation: fetchImplementation as typeof fetch,
				traceDataProvider: () => ({}),
			},
		);

		await expect(
			requestExecutionControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(observedThis).toBeUndefined();
	});
});

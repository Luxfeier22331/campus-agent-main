// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionControlRequester } from "../src/modules/integration/execution-control-runtime";

afterEach(() => {
	vi.unstubAllGlobals();
});

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

	it("uses the execution-control private service binding when configured", async () => {
		const privateFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const requestExecutionControl = createExecutionControlRequester(
			{
				APP_API_ENVIRONMENT: "staging",
				EXECUTION_CONTROL_PRIVATE: { fetch: privateFetch },
				EXECUTION_CONTROL_PRIVATE_ORIGIN: "http://execution-control.internal:8000",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
				EXECUTION_CONTROL_TIMEOUT_MS: "1000",
			},
			{},
		);

		await expect(
			requestExecutionControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(privateFetch).toHaveBeenCalledWith(
			"http://execution-control.internal:8000/internal/probe",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("ignores injected fetch overrides in staging and keeps requests on the private binding", async () => {
		const overrideFetch = vi.fn().mockResolvedValue(new Response(null, { status: 599 }));
		const privateFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const requestExecutionControl = createExecutionControlRequester(
			{
				APP_API_ENVIRONMENT: "staging",
				EXECUTION_CONTROL_PRIVATE: { fetch: privateFetch },
				EXECUTION_CONTROL_PRIVATE_ORIGIN: "http://execution-control.internal:8000",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
				EXECUTION_CONTROL_TIMEOUT_MS: "1000",
			},
			{
				fetchImplementation: overrideFetch,
			},
		);

		await expect(
			requestExecutionControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(privateFetch).toHaveBeenCalledTimes(1);
		expect(overrideFetch).not.toHaveBeenCalled();
	});

	it("fails closed in staging when the private service binding is missing", async () => {
		const requestExecutionControl = createExecutionControlRequester(
			{
				APP_API_ENVIRONMENT: "staging",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.invalid",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
				EXECUTION_CONTROL_TIMEOUT_MS: "1000",
			},
			{},
		);

		await expect(
			requestExecutionControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).rejects.toMatchObject({
			code: "dependency_not_ready",
			status: 503,
		});
	});
});

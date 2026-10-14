// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentControlRequester } from "../src/modules/integration/agent-control-runtime";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("agent control requester", () => {
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
		const requestAgentControl = createAgentControlRequester(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				CLUSTER_PRIVATE_BASE_URL: "http://agent-control.local",
				EDGE_INGRESS_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: fetchImplementation as typeof fetch,
			},
		);

		await expect(
			requestAgentControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(observedThis).toBeUndefined();
	});

	it("uses the agent-control private service binding when configured", async () => {
		const privateFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const requestAgentControl = createAgentControlRequester(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				CLUSTER_PRIVATE_API: { fetch: privateFetch },
				CLUSTER_PRIVATE_ORIGIN: "http://agent-control.internal:8000",
				EDGE_INGRESS_SHARED_SECRET: "shared-secret",
			},
			{},
		);

		await expect(
			requestAgentControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(privateFetch).toHaveBeenCalledWith(
			"http://agent-control.internal:8000/v1/control/internal/probe",
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
		const requestAgentControl = createAgentControlRequester(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				CLUSTER_PRIVATE_API: { fetch: privateFetch },
				CLUSTER_PRIVATE_ORIGIN: "http://agent-control.internal:8000",
				EDGE_INGRESS_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: overrideFetch,
			},
		);

		await expect(
			requestAgentControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).resolves.toEqual({ ok: true });
		expect(privateFetch).toHaveBeenCalledTimes(1);
		expect(overrideFetch).not.toHaveBeenCalled();
	});

	it("fails closed in staging when the private service binding is missing", async () => {
		const requestAgentControl = createAgentControlRequester(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				CLUSTER_PRIVATE_BASE_URL: "https://agent-control.example.invalid",
				EDGE_INGRESS_SHARED_SECRET: "shared-secret",
			},
			{},
		);

		await expect(
			requestAgentControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).rejects.toMatchObject({
			code: "dependency_not_ready",
			status: 503,
		});
	});

	it("rejects redirects without forwarding the worker secret", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(null, {
				headers: { location: "https://attacker.example/internal/probe" },
				status: 307,
			}),
		);
		const requestAgentControl = createAgentControlRequester(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				CLUSTER_PRIVATE_BASE_URL: "http://agent-control.local",
				EDGE_INGRESS_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			requestAgentControl("/internal/probe", {
				expectedStatus: 200,
				method: "GET",
			}),
		).rejects.toMatchObject({
			code: "agent_control_invalid_response",
			retryable: false,
			status: 502,
		});
		expect(fetchImplementation).toHaveBeenCalledTimes(1);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"http://agent-control.local/v1/control/internal/probe",
			expect.objectContaining({ redirect: "manual" }),
		);
	});
});

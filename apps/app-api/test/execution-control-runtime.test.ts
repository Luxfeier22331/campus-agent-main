// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionControlProviderConfigClient } from "../src/modules/integration/execution-control-provider-config";
import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRequester,
} from "../src/modules/integration/execution-control-runtime";

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

	it("keeps default worker fetch bound to the global runtime object", async () => {
		vi.stubGlobal("fetch", function (
			this: unknown,
			_input: RequestInfo | URL,
			_init?: RequestInit,
		): Promise<Response> {
			if (this !== globalThis) {
				throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						status: "disabled",
						updated_at: "2026-06-25T00:00:00.000Z",
						user_id: "user_01HQ",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 202,
					},
				),
			);
		} as typeof fetch);
		const client = createExecutionControlPersonalMemoryClient({
			EXECUTION_CONTROL_BASE_URL: "http://execution-control.local",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			EXECUTION_CONTROL_TIMEOUT_MS: "1000",
		});

		await expect(
			client.disableOwnerMemory({
				updatedAt: "2026-06-25T00:00:00.000Z",
				userId: "user_01HQ",
			}),
		).resolves.toEqual({
			status: "disabled",
			updatedAt: "2026-06-25T00:00:00.000Z",
			userId: "user_01HQ",
		});
	});

	it("keeps provider-config compatibility checks on the bound worker fetch path", async () => {
		vi.stubGlobal("fetch", function (
			this: unknown,
			_input: RequestInfo | URL,
			_init?: RequestInit,
		): Promise<Response> {
			if (this !== globalThis) {
				throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
			}
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true, reason: "" }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			);
		} as typeof fetch);
		const client = createExecutionControlProviderConfigClient({
			EXECUTION_CONTROL_BASE_URL: "http://execution-control.local",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			EXECUTION_CONTROL_TIMEOUT_MS: "1000",
		});

		await expect(
			client.checkEmbeddingCompatibility({
				baseUrl: "https://embedding.example/v1",
				dimensions: 2560,
				model: "Qwen3-Embedding-4B",
				provider: "openai-compatible",
				role: "rag_query_embedding",
				timeoutMs: 30000,
				transport: "embeddings",
			}),
		).resolves.toEqual({ ok: true, reason: "" });
	});
});

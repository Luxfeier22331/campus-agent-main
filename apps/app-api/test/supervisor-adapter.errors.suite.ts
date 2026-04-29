import { expect, it, vi } from "vitest";

import type { SupervisorAdapterSuiteContext } from "./supervisor-adapter.test-support";

export function registerSupervisorAdapterErrorsSuite(ctx: SupervisorAdapterSuiteContext): void {
	const { createActor, createContext, createSupervisorExecutionClient } = ctx;

	it("raises execution_timeout when the supervisor call exceeds the timeout budget", async () => {
		vi.useFakeTimers();
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
				SUPERVISOR_API_TIMEOUT_MS: "25",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockImplementation(() => new Promise<Response>(() => undefined)),
			},
		);

		const pending = client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			traceId: "trace_01HQ",
			userGoal: "图书馆开放到几点？",
		});

		const assertion = expect(pending).rejects.toMatchObject({
			code: "execution_timeout",
			retryable: true,
			status: 504,
		});

		await vi.advanceTimersByTimeAsync(25);
		await assertion;
	});
	it("gives eval_benchmark requests a longer timeout budget than the default chat ceiling", async () => {
		vi.useFakeTimers();
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
				SUPERVISOR_API_TIMEOUT_MS: "25",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockImplementation(() => new Promise<Response>(() => undefined)),
			},
		);

		const pending = client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			surface: "eval_benchmark",
			traceId: "trace_01HQ",
			userGoal: "图书馆开放到几点？",
		});

		await vi.advanceTimersByTimeAsync(25);
		await vi.advanceTimersByTimeAsync(1);
		const marker = Symbol("pending");
		expect(await Promise.race([pending.catch(() => "rejected"), Promise.resolve(marker)])).toBe(
			marker,
		);
		pending.catch(() => undefined);
	});
	it("raises supervisor_invalid_response when the upstream body is not valid json", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("not-json", {
						headers: {
							"content-type": "application/json",
						},
						status: 200,
					}),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).rejects.toMatchObject({
			code: "supervisor_invalid_response",
			retryable: true,
			status: 502,
		});
	});
	it("raises supervisor_invalid_response when the upstream body violates canonical wire shape", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							answerText: "camelCase is not supervisor execution wire.",
							error: null,
							followUpQuestion: "",
							result: null,
							selectedTarget: "rag-agent",
							status: "completed",
							traceId: "trace_invalid_wire",
						}),
						{ status: 200 },
					),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).rejects.toMatchObject({
			code: "supervisor_invalid_response",
			retryable: true,
			status: 502,
		});
	});
}

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createAxiomRuntimeEventSink,
	sanitizeAxiomEventPayload,
} from "../src/modules/telemetry/axiom";

describe("axiom runtime event sink", () => {
	it("drops forbidden sensitive fields before building the ingest payload", () => {
		expect(
			sanitizeAxiomEventPayload({
				environment: "staging",
				event_type: "request.accepted",
				occurred_at: "2026-04-20T12:30:00.000Z",
				request_id: "req_01HQ",
				release: "app-api@2026.04.20",
				trace_id: "trace_01HQ",
				surface: "public_chat_web",
				status: "accepted",
				unexpected_blob: "should-not-pass",
				prompt: "图书馆开放到几点？",
				answer: "图书馆开放到 22:00。",
				cookie: "better-auth.session_token=test",
				operator_email: "ops@example.com",
				transcript: "user: ...",
			}),
		).toEqual({
			environment: "staging",
			event_type: "request.accepted",
			occurred_at: "2026-04-20T12:30:00.000Z",
			request_id: "req_01HQ",
			release: "app-api@2026.04.20",
			status: "accepted",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});
	});

	it("drops unsupported event types instead of treating axiom as a kitchen-sink dataset", () => {
		expect(
			sanitizeAxiomEventPayload({
				event_type: "experimental.debug_dump",
				occurred_at: "2026-04-20T12:30:00.000Z",
				request_id: "req_01HQ",
				surface: "public_chat_web",
				trace_id: "trace_01HQ",
			}),
		).toBeNull();
	});

	it("allows only safe execution audit event fields", () => {
		expect(
			sanitizeAxiomEventPayload({
				answer: "raw answer must not pass",
				bridge_duration_ms: 35000,
				decision: "queue_full",
				duration_ms: 35012,
				environment: "staging",
				event_type: "execution.bridge_failed",
				failure_kind: "timeout",
				http_status: 504,
				lane: "rag",
				occurred_at: "2026-04-24T10:00:00.000Z",
				prompt: "raw prompt must not pass",
				queue_wait_ms: 12,
				release: "app-api@2026.04.24",
				request_id: "req_01HQ",
				requested_capability: "knowledge",
				retryable: true,
				status: "error",
				surface: "public_chat_web",
				trace_id: "trace_01HQ",
			}),
		).toEqual({
			bridge_duration_ms: 35000,
			decision: "queue_full",
			duration_ms: 35012,
			environment: "staging",
			event_type: "execution.bridge_failed",
			failure_kind: "timeout",
			http_status: 504,
			lane: "rag",
			occurred_at: "2026-04-24T10:00:00.000Z",
			queue_wait_ms: 12,
			release: "app-api@2026.04.24",
			request_id: "req_01HQ",
			requested_capability: "knowledge",
			retryable: true,
			status: "error",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});
	});

	it("no-ops when the Axiom runtime config is incomplete", async () => {
		const fetchImplementation = vi.fn();
		const sink = createAxiomRuntimeEventSink(
			{},
			{
				fetchImplementation,
			},
		);

		await sink.emit({
			event_type: "request.accepted",
			request_id: "req_01HQ",
			status: "accepted",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});

		expect(fetchImplementation).not.toHaveBeenCalled();
	});

	it("posts structured events to the dataset ingest endpoint when using the shared Axiom API domain", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const sink = createAxiomRuntimeEventSink(
			{
				AXIOM_DATASET: "campus_agent_runtime",
				AXIOM_ENDPOINT: "https://api.axiom.co",
				AXIOM_TOKEN: "axiom-secret",
			},
			{
				fetchImplementation,
			},
		);

		await sink.emit({
			event_type: "request.finalized",
			request_id: "req_01HQ",
			requested_scope_summary: "regulations/student_rules",
			status: "completed",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://api.axiom.co/v1/datasets/campus_agent_runtime/ingest",
			expect.objectContaining({
				body: JSON.stringify([
					{
						event_type: "request.finalized",
						request_id: "req_01HQ",
						requested_scope_summary: "regulations/student_rules",
						status: "completed",
						surface: "public_chat_web",
						trace_id: "trace_01HQ",
					},
				]),
				headers: {
					Authorization: "Bearer axiom-secret",
					"Content-Type": "application/json",
				},
				method: "POST",
			}),
		);
	});

	it("posts structured events to the edge ingest endpoint when using an edge deployment domain", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const sink = createAxiomRuntimeEventSink(
			{
				AXIOM_DATASET: "campus_agent_runtime",
				AXIOM_ENDPOINT: "https://us-east-1.aws.edge.axiom.co",
				AXIOM_TOKEN: "axiom-secret",
			},
			{
				fetchImplementation,
			},
		);

		await sink.emit({
			event_type: "request.finalized",
			request_id: "req_01HQ",
			requested_scope_summary: "regulations/student_rules",
			status: "completed",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://us-east-1.aws.edge.axiom.co/v1/ingest/campus_agent_runtime",
			expect.objectContaining({
				body: JSON.stringify([
					{
						event_type: "request.finalized",
						request_id: "req_01HQ",
						requested_scope_summary: "regulations/student_rules",
						status: "completed",
						surface: "public_chat_web",
						trace_id: "trace_01HQ",
					},
				]),
				headers: {
					Authorization: "Bearer axiom-secret",
					"Content-Type": "application/json",
				},
				method: "POST",
			}),
		);
	});

	it("fails open when the Axiom ingest fetch exceeds the timeout budget", async () => {
		vi.useFakeTimers();

		const logger = { warn: vi.fn() };
		const fetchImplementation = vi.fn(
			(_input: URL | RequestInfo, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		);
		const sink = createAxiomRuntimeEventSink(
			{
				AXIOM_DATASET: "campus_agent_runtime",
				AXIOM_ENDPOINT: "https://us-east-1.aws.edge.axiom.co",
				AXIOM_TOKEN: "axiom-secret",
			},
			{
				fetchImplementation,
				logger,
				timeoutMs: 10,
			},
		);

		const emitPromise = sink.emit({
			event_type: "request.finalized",
			request_id: "req_01HQ",
			status: "completed",
			surface: "public_chat_web",
			trace_id: "trace_01HQ",
		});

		await vi.advanceTimersByTimeAsync(10);
		await emitPromise;

		expect(fetchImplementation).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			"Axiom ingest failed: Axiom ingest timed out after 10ms.",
		);

		vi.useRealTimers();
	});
});

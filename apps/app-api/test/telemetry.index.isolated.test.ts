// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
	captureException: vi.fn(),
	setContext: vi.fn(),
	setTag: vi.fn(),
	withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
		callback({
			setTag: vi.fn(),
		}),
	),
}));

vi.mock("@sentry/cloudflare", () => sentryMocks);

import { createAppTelemetry } from "../src/modules/telemetry";
import {
	applyTracePropagationHeaders,
	deriveLangfuseTraceId,
	ensureLangfuseTraceParent,
	traceParentForLangfuseTraceId,
} from "../src/modules/telemetry/trace";

interface LangfuseTraceIdVector {
	langfuse_trace_id: string;
	product_trace_id: string;
	traceparent: string;
}

function langfuseTraceIdVectors(): LangfuseTraceIdVector[] {
	const fixturePath = resolve(
		process.cwd(),
		"../../packages/eval-langfuse/test/fixtures/langfuse_trace_id_vectors.json",
	);
	const payload = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
		vectors: LangfuseTraceIdVector[];
	};
	return payload.vectors;
}

describe("app telemetry", () => {
	beforeEach(() => {
		sentryMocks.captureException.mockReset();
		sentryMocks.setContext.mockReset();
		sentryMocks.setTag.mockReset();
		sentryMocks.withScope.mockReset();
		sentryMocks.withScope.mockImplementation(
			(callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
				callback({
					setTag: vi.fn(),
				}),
		);
	});

	it("keeps request scope updates non-blocking when Sentry fails", () => {
		sentryMocks.setTag.mockImplementation(() => {
			throw new Error("sentry setTag failed");
		});
		const telemetry = createAppTelemetry();

		expect(() =>
			telemetry.configureChatRequestScope({
				requestId: "req_01",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).not.toThrow();
		expect(() =>
			telemetry.configureRequestOutcome({
				errorCode: "execution_timeout",
				requestId: "req_01",
				status: "error",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).not.toThrow();
	});

	it("configures only bounded request and outcome tags in Sentry", () => {
		const telemetry = createAppTelemetry();

		telemetry.configureChatRequestScope({
			requestId: "req_01",
			surface: "campus_web",
			traceId: "trace_01",
		});
		telemetry.configureRequestOutcome({
			errorCode: "execution_timeout",
			requestId: "req_01",
			status: "error",
			surface: "campus_web",
			traceId: "trace_01",
		});

		expect(sentryMocks.setTag).toHaveBeenCalledWith("campus.request_id", "req_01");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("campus.trace_id", "trace_01");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("surface", "campus_web");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("status", "error");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("error_code", "execution_timeout");
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("principal_type", expect.anything());
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("safety_identifier", expect.anything());
		expect(sentryMocks.setContext).not.toHaveBeenCalled();
	});

	it("derives deterministic Langfuse-compatible trace ids from product trace ids", async () => {
		const traceId = await deriveLangfuseTraceId("trace_0001");

		expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
		expect(traceId).toBe(await deriveLangfuseTraceId("trace_0001"));
		expect(traceId).not.toBe(await deriveLangfuseTraceId("trace_0002"));
		expect(traceParentForLangfuseTraceId(traceId)).toBe(`00-${traceId}-0000000000000001-01`);
	});

	it("matches shared Langfuse trace id derivation vectors used by eval publishing", async () => {
		for (const vector of langfuseTraceIdVectors()) {
			expect(await deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});

	it("pins the internal traceparent and drops browser propagation headers", async () => {
		const traceHeaders = await ensureLangfuseTraceParent("trace_0001");
		const langfuseTraceId = await deriveLangfuseTraceId("trace_0001");

		expect(traceHeaders).toEqual({
			traceParent: `00-${langfuseTraceId}-0000000000000001-01`,
		});
	});

	it("writes only a valid W3C traceparent", () => {
		const headers = new Headers();
		applyTracePropagationHeaders(headers, {
			traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		});

		expect(headers.get("traceparent")).toBe(
			"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		);
	});

	it("does not write malformed or zero W3C traceparents", () => {
		for (const traceParent of [
			"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-09",
			"00-00000000000000000000000000000000-00f067aa0ba902b7-01",
			"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
			"not-a-traceparent",
		]) {
			const headers = new Headers();
			applyTracePropagationHeaders(headers, { traceParent });
			expect(headers.has("traceparent")).toBe(false);
		}
	});
});

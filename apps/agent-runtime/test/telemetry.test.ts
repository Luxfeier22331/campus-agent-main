import type { Attributes, SpanStatus } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { AgentsOpenTelemetryProcessor, safeSpanProjection } from "../src/telemetry.ts";

describe("agent runtime telemetry", () => {
	it("maps Agents spans without model or tool payloads", () => {
		const generation = safeSpanProjection({
			type: "generation",
			input: [{ content: "private prompt" }],
			output: [{ content: "private answer" }],
			model: "gpt-test",
			usage: { input_tokens: 12, output_tokens: 8 },
		});
		const tool = safeSpanProjection({
			type: "function",
			name: "knowledge_search",
			input: '{"authorization":"secret"}',
			output: "private result",
		});

		expect(generation.attributes).toMatchObject({
			"gen_ai.request.model": "gpt-test",
			"gen_ai.usage.input_tokens": 12,
			"gen_ai.usage.output_tokens": 8,
		});
		expect(tool.attributes).toEqual({ "gen_ai.tool.name": "knowledge_search" });
		expect(JSON.stringify([generation, tool])).not.toMatch(
			/private prompt|private answer|private result|authorization|secret/u,
		);
	});

	it("creates and closes OTel spans without exporter work in callbacks", async () => {
		const started: Array<{ attributes?: Attributes; name: string }> = [];
		const ended: string[] = [];
		const statuses: SpanStatus[] = [];
		const tracer = {
			startSpan(name: string, options?: { attributes?: Attributes }) {
				started.push({ attributes: options?.attributes, name });
				return {
					end: () => ended.push(name),
					setStatus: (status: SpanStatus) => statuses.push(status),
				};
			},
		};
		const processor = new AgentsOpenTelemetryProcessor(tracer as never);
		const agentTrace = {
			metadata: {
				"campus.trace_id": "trace-product",
				ignored: "private metadata",
				"request.id": "request-1",
				"run.id": "run-1",
			},
			name: "campus-agent.primary-agent",
			traceId: "agents-trace-1",
		};
		const agentSpan = {
			endedAt: "2026-07-11T00:00:01.000Z",
			error: null,
			parentId: null,
			spanData: { type: "generation", model: "gpt-test", usage: {} },
			spanId: "agents-span-1",
			startedAt: "2026-07-11T00:00:00.000Z",
			traceId: "agents-trace-1",
		};

		await processor.onTraceStart(agentTrace as never);
		await processor.onSpanStart(agentSpan as never);
		await processor.onSpanEnd(agentSpan as never);
		await processor.onTraceEnd(agentTrace as never);

		expect(started.map((item) => item.name)).toEqual(["campus-agent.primary-agent", "generation"]);
		expect(started[0]?.attributes).toMatchObject({
			"campus.trace_id": "trace-product",
			"request.id": "request-1",
			"run.id": "run-1",
		});
		expect(JSON.stringify(started)).not.toContain("private metadata");
		expect(ended).toEqual(["generation", "campus-agent.primary-agent"]);
		expect(statuses).toEqual([{ code: 1 }]);
	});
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableEvent, durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

describe("runtime run browser projection", () => {
	it("projects the browser-visible run completion as a product completion", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "run.completed",
						payload: {
							request_id: "req_01HQ",
							status: "completed",
							terminal_reason: "answer_completed",
						},
						sequence: 3,
					}),
				]),
			),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const result = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			requestId: "req_01HQ",
		});

		expect(result.events).toEqual([
			expect.objectContaining({
				eventType: "request.completed",
				payload: {
					status: "completed",
					terminal_reason: "answer_completed",
				},
			}),
		]);
	});

	it("strips internal finalization payload from student-visible run events", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "finalization.completed",
						payload: {
							agent_result_ref: "agent-result-hidden",
							observability: {
								prompt_trace: {
									rendered_prompt_sha256: "hidden",
								},
							},
							request_id: "req_01HQ",
							response: {
								result: {
									tool_results: [{ raw: "hidden" }],
								},
							},
						},
						sequence: 3,
					}),
				]),
			),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const result = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			requestId: "req_01HQ",
		});

		expect(result).toEqual({
			events: [
				expect.objectContaining({
					eventType: "request.completed",
					payload: {},
				}),
			],
			nextSequence: 3,
			run: expect.objectContaining({
				phase: "completed",
				requestId: "req_01HQ",
			}),
		});
		const serializedPayload = JSON.stringify(result.events[0]?.payload);
		expect(serializedPayload).not.toContain("response");
		expect(serializedPayload).not.toContain("observability");
		expect(serializedPayload).not.toContain("tool_results");
	});
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { AgentControlRuntimeClient } from "../src/modules/integration/agent-control";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableEvent, durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

describe("runtime run browser projection", () => {
	it("projects the browser-visible run completion as a product completion", async () => {
		const executionRuntime: AgentControlRuntimeClient = {
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

	it("filters internal and legacy browser finalization events while advancing the cursor", async () => {
		const executionRuntime: AgentControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "finalization.reserved",
						payload: {
							completed_at: "2026-06-04T01:02:08.000Z",
							finalization_fingerprint_sha256: "a".repeat(64),
							request_id: "req_01HQ",
							started_at: "2026-06-04T01:02:07.000Z",
							workflow_result_ref: "workflow-result",
						},
						sequence: 2,
						visibility: "internal",
					}),
					durableEvent({
						eventType: "finalization.completed",
						payload: {
							request_id: "req_01HQ",
							response: {
								answer_text: "hidden",
								result: { tool_results: [{ raw: "hidden" }] },
							},
						},
						sequence: 3,
						visibility: "internal",
					}),
					durableEvent({
						eventType: "finalization.completed",
						payload: {
							agent_result_ref: "agent-result-hidden",
							request_id: "req_01HQ",
							response: {
								result: {
									tool_results: [{ raw: "hidden" }],
								},
							},
						},
						sequence: 4,
					}),
				]),
			),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const result = await service.listEvents({
			afterSequence: 1,
			principal: createPrincipal(),
			requestId: "req_01HQ",
		});

		expect(result).toEqual({
			events: [],
			nextSequence: 4,
			run: expect.objectContaining({
				phase: "completed",
				requestId: "req_01HQ",
			}),
		});
	});

	it("uses run.completed as the only successful terminal after a legacy event", async () => {
		const events = [
			durableEvent({
				eventType: "finalization.completed",
				payload: { request_id: "req_01HQ" },
				sequence: 3,
			}),
			durableEvent({
				eventType: "run.completed",
				payload: {
					request_id: "req_01HQ",
					status: "completed",
					terminal_reason: "answer_completed",
				},
				sequence: 4,
			}),
		];
		const executionRuntime: AgentControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi
				.fn()
				.mockImplementation(({ afterSequence = 0 }) =>
					Promise.resolve(eventPage(events.filter((event) => event.sequence > afterSequence))),
				),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		await expect(
			service.listEvents({
				principal: createPrincipal(),
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({
			events: [expect.objectContaining({ eventType: "request.completed", sequence: 4 })],
			nextSequence: 4,
		});

		await expect(
			service.listEvents({
				afterSequence: 3,
				principal: createPrincipal(),
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({
			events: [expect.objectContaining({ eventType: "request.completed", sequence: 4 })],
			nextSequence: 4,
		});
	});

	it("derives finalizing duration from the durable progress and completion timestamps", async () => {
		const executionRuntime: AgentControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(
				durableRun({
					completedAt: "2026-06-04T01:02:08.250Z",
					status: "completed",
				}),
			),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "run.progress",
						occurredAt: "2026-06-04T01:02:07.000Z",
						payload: { phase: "finalizing", request_id: "req_01HQ" },
						sequence: 2,
					}),
					durableEvent({
						eventType: "run.completed",
						occurredAt: "2026-06-04T01:02:08.250Z",
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

		const result = await service.listSteps({
			principal: createPrincipal(),
			requestId: "req_01HQ",
		});

		expect(result.steps.find((step) => step.phase === "finalizing")).toMatchObject({
			completedAt: "2026-06-04T01:02:08.250Z",
			durationMs: 1250,
			startedAt: "2026-06-04T01:02:07.000Z",
			status: "completed",
		});
	});

	it("does not invent a finalizing phase from answer completion", async () => {
		const executionRuntime: AgentControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "running" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "run.answer_completed",
						sequence: 3,
					}),
				]),
			),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		await expect(
			service.listEvents({
				afterSequence: 2,
				principal: createPrincipal(),
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({ events: [], nextSequence: 3 });
	});
});

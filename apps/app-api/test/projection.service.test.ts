// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildRequestProjectionProjector,
	type ProjectionOutboxEvent,
	type RequestExecutionProjectionSource,
	type RequestProjectionProjectorStore,
} from "../src/modules/projection";

function createExecutionSource(
	overrides: Partial<RequestExecutionProjectionSource> = {},
): RequestExecutionProjectionSource {
	return {
		aclAnomalyCode: null,
		aclDecision: "allowed",
		answerPreview: "图书馆开放到 22:00。",
		applicabilityScope: "undergraduate",
		completedAt: "2026-03-28T08:00:01.000Z",
		conversationId: "conv_01HQ",
		durationMs: 842,
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		errorCode: null,
		failClosed: false,
		policyProjectionVersion: "2026-03-29",
		principalId: "user_01HQ",
		principalLabel: "Jane Doe",
		principalType: "student",
		projectedAtHint: "2026-03-28T08:00:02.000Z",
		questionPreview: "图书馆开放到几点？",
		requestedScope: "student_rules",
		requestedTool: "knowledge_query",
		requestId: "req_01HQ",
		resolvedScope: "student_rules",
		selectedTool: "knowledge_query",
		sourceDocIds: ["handbook:library-hours"],
		startedAt: "2026-03-28T08:00:00.000Z",
		status: "completed",
		surface: "campus_web",
		traceId: "trace_01HQ",
		versionQuery: null,
		visibilityScope: "main",
		...overrides,
	};
}

function createPendingEvent(overrides: Partial<ProjectionOutboxEvent> = {}): ProjectionOutboxEvent {
	return {
		attemptCount: 0,
		availableAt: "2026-03-28T08:00:02.000Z",
		eventId: "evt_completed",
		eventType: "request.completed",
		occurredAt: "2026-03-28T08:00:02.000Z",
		payload: {},
		processedAt: null,
		requestId: "req_01HQ",
		...overrides,
	};
}

function createStore(
	overrides: Partial<RequestProjectionProjectorStore> = {},
): RequestProjectionProjectorStore {
	return {
		getRequestExecution: vi.fn().mockResolvedValue(createExecutionSource()),
		listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
		listPendingEventsForRequest: vi.fn().mockResolvedValue([createPendingEvent()]),
		markEventFailed: vi.fn(),
		markEventProcessed: vi.fn(),
		markObservabilityProjected: vi.fn(),
		upsertAuditProjection: vi.fn(),
		upsertProjection: vi.fn(),
		...overrides,
	};
}

describe("request projection projector", () => {
	it("materializes request truth and marks the outbox event processed", async () => {
		const store = createStore({
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					versionQuery: {
						compareToVersionId: "v2025-student-rules",
						mode: "compare",
						versionId: "v2024-student-rules",
					},
				}),
			),
		});
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await expect(projector.drain()).resolves.toEqual({ failed: 0, processed: 1 });
		expect(store.upsertProjection).toHaveBeenCalledWith({
			answerPreview: "图书馆开放到 22:00。",
			applicabilityScope: "undergraduate",
			completedAt: "2026-03-28T08:00:01.000Z",
			conversationId: "conv_01HQ",
			durationMs: 842,
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements-2026-03-29",
			errorCode: null,
			principalId: "user_01HQ",
			principalLabel: "Jane Doe",
			principalType: "student",
			projectedAt: "2026-03-28T08:00:03.000Z",
			questionPreview: "图书馆开放到几点？",
			requestedScope: "student_rules",
			requestedTool: "knowledge_query",
			requestId: "req_01HQ",
			resolvedScope: "student_rules",
			selectedTool: "knowledge_query",
			sourceDocIds: ["handbook:library-hours"],
			startedAt: "2026-03-28T08:00:00.000Z",
			status: "completed",
			surface: "campus_web",
			traceId: "trace_01HQ",
			versionQuery: {
				compareToVersionId: "v2025-student-rules",
				mode: "compare",
				versionId: "v2024-student-rules",
			},
			visibilityScope: "main",
		});
		expect(store.markObservabilityProjected).toHaveBeenCalledWith({
			measuredAt: "2026-03-28T08:00:03.000Z",
			projectionLagMs: 3000,
			requestId: "req_01HQ",
		});
		expect(store.markEventProcessed).toHaveBeenCalledWith({
			eventId: "evt_completed",
			processedAt: "2026-03-28T08:00:03.000Z",
		});
	});

	it("drains one request through the dedicated request lookup", async () => {
		const store = createStore();
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await expect(projector.drainRequest("req_01HQ")).resolves.toEqual({
			failed: 0,
			processed: 1,
		});
		expect(store.listPendingEventsForRequest).toHaveBeenCalledWith(
			"req_01HQ",
			new Date("2026-03-28T08:00:03.000Z"),
		);
		expect(store.listPendingEvents).not.toHaveBeenCalled();
	});

	it("keeps audit status aligned with the outbox event", async () => {
		const store = createStore({
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					eventId: "evt_accept",
					eventType: "request.accepted",
				}),
			]),
		});
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await projector.drain();

		expect(store.upsertAuditProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				auditEventId: "evt_accept",
				eventType: "request.accepted",
				status: "accepted",
				terminalCode: "completed",
			}),
		);
	});

	it("projects sanitized execution audit diagnostics", async () => {
		const store = createStore({
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					errorCode: "execution_timeout",
					status: "error",
				}),
			),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					eventId: "execution-control:req_01HQ:execution.activity_failed",
					eventType: "execution.activity_failed",
					payload: {
						activityDurationMs: 35000,
						decision: null,
						durationMs: 35012,
						failureKind: "timeout",
						httpStatus: 504,
						queueWaitMs: 12,
						retryable: true,
						taskQueue: "campus-agent.workflow",
					},
				}),
			]),
		});
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await projector.drain();

		expect(store.upsertAuditProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				auditEventId: "execution-control:req_01HQ:execution.activity_failed",
				diagnostics: {
					aclAnomalyCode: null,
					activityDurationMs: 35000,
					decision: null,
					durationMs: 35012,
					failClosed: false,
					failureKind: "timeout",
					httpStatus: 504,
					queueWaitMs: 12,
					retryable: true,
					sourceDocIds: ["handbook:library-hours"],
					taskQueue: "campus-agent.workflow",
				},
				eventType: "execution.activity_failed",
				status: "error",
				summary: "Execution activity failed: timeout.",
			}),
		);
	});

	it("retries missing request truth and closes the event after the retry budget", async () => {
		const now = vi
			.fn<() => Date>()
			.mockReturnValueOnce(new Date("2026-03-28T08:00:03.000Z"))
			.mockReturnValueOnce(new Date("2026-03-28T08:00:03.000Z"))
			.mockReturnValueOnce(new Date("2026-03-28T08:00:03.000Z"));
		const retryStore = createStore({
			getRequestExecution: vi.fn().mockResolvedValue(null),
		});
		const retryProjector = buildRequestProjectionProjector({ now, store: retryStore });

		await expect(retryProjector.drain()).resolves.toEqual({ failed: 1, processed: 0 });
		expect(retryStore.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 1,
			availableAt: "2026-03-28T08:00:08.000Z",
			eventId: "evt_completed",
			lastError: "Missing request_execution for req_01HQ.",
			processedAt: null,
		});

		const terminalStore = createStore({
			getRequestExecution: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi
				.fn()
				.mockResolvedValue([createPendingEvent({ attemptCount: 4, eventId: "evt_terminal" })]),
		});
		const terminalProjector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store: terminalStore,
		});

		await expect(terminalProjector.drain()).resolves.toEqual({ failed: 1, processed: 0 });
		expect(terminalStore.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 5,
			availableAt: "2026-03-28T08:00:03.000Z",
			eventId: "evt_terminal",
			lastError: "Missing request_execution for req_01HQ.",
			processedAt: "2026-03-28T08:00:03.000Z",
		});
	});
});

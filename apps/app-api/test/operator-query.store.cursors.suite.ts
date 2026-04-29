import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreCursorsSuite(ctx: OperatorQueryStoreSuiteContext): void {
	const {
		createPgOperatorQueryStore,
		createRuntimeDatabase,
		encodeBase64UrlJson,
		resetOperatorQueryStoreMocks,
	} = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("returns opaque quality badcase cursors for the last visible row", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_01",
				causeClass: "unknown_runtime_failure",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_01",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "First badcase",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				badcaseId: "badcase_02",
				causeClass: "unknown_runtime_failure",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:00:00.000Z"),
				requestId: "req_02",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "Second badcase",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 1,
			selectedTarget: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				badcaseId: "badcase_01",
				openedAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe("badcase_02");
	});
	it("returns opaque request cursors for the last visible row", async () => {
		const requestRows = [
			{
				answerPreview: "First answer",
				completedAt: new Date("2026-04-01T10:00:01.000Z"),
				conversationId: "conv_01",
				createdAt: new Date("2026-04-01T10:00:00.000Z"),
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				principalDisplayName: "Student One",
				principalId: "student_01",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				queryPreview: "First question",
				requestedCapability: "knowledge",
				requestedScopeJson: null,
				requestId: "req_01",
				resolvedScopeJson: null,
				selectedTarget: "rag-agent",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_01",
				updatedAt: new Date("2026-04-01T10:00:02.000Z"),
				versionQueryJson: null,
			},
			{
				answerPreview: "Second answer",
				completedAt: new Date("2026-04-01T09:00:01.000Z"),
				conversationId: "conv_02",
				createdAt: new Date("2026-04-01T09:00:00.000Z"),
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				principalDisplayName: "Student Two",
				principalId: "student_02",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T09:00:02.000Z"),
				queryPreview: "Second question",
				requestedCapability: "knowledge",
				requestedScopeJson: null,
				requestId: "req_02",
				resolvedScopeJson: null,
				selectedTarget: "rag-agent",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_02",
				updatedAt: new Date("2026-04-01T09:00:02.000Z"),
				versionQueryJson: null,
			},
		];
		const requestLimit = vi.fn().mockResolvedValue(requestRows);
		const requestOrderBy = vi.fn(() => ({ limit: requestLimit }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: requestOrderBy,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.list({
			conversationId: null,
			cursor: null,
			limit: 1,
			q: null,
			requestId: null,
			status: null,
			surface: null,
		});

		expect(result.requests).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				requestId: "req_01",
				startedAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				requestId: "req_02",
				startedAt: "2026-04-01T09:00:00.000Z",
			}),
		);
	});
	it("returns opaque audit cursors for the last visible row", async () => {
		const auditRows = [
			{
				auditEventId: "audit_01",
				eventType: "request.completed",
				metadataJson: null,
				occurredAt: new Date("2026-04-01T10:00:00.000Z"),
				principalId: "student_01",
				principalType: "campus_member",
				requestId: "req_01",
				selectedTarget: "rag-agent",
				status: "completed",
				summary: "First event",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				auditEventId: "audit_02",
				eventType: "request.completed",
				metadataJson: null,
				occurredAt: new Date("2026-04-01T09:00:00.000Z"),
				principalId: "student_02",
				principalType: "campus_member",
				requestId: "req_02",
				selectedTarget: "rag-agent",
				status: "completed",
				summary: "Second event",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const auditLimit = vi.fn().mockResolvedValue(auditRows);
		const auditOrderBy = vi.fn(() => ({ limit: auditLimit }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: auditOrderBy,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listAudit({
			cursor: null,
			eventType: null,
			limit: 1,
			principalType: null,
			requestId: null,
			selectedTarget: null,
			status: null,
			surface: null,
			traceId: null,
		});

		expect(result.events).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				auditEventId: "audit_01",
				occurredAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				auditEventId: "audit_02",
				occurredAt: "2026-04-01T09:00:00.000Z",
			}),
		);
	});
	it("returns opaque safety anomaly cursors for the last visible row", async () => {
		const anomalyRows = [
			{
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				principalType: "campus_member",
				requestedCapability: "knowledge",
				requestId: "req_01",
				selectedTarget: "rag-agent",
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				principalType: "campus_member",
				requestedCapability: "knowledge",
				requestId: "req_02",
				selectedTarget: "rag-agent",
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const anomalyLimit = vi.fn().mockResolvedValue(anomalyRows);
		const anomalyOrderBy = vi.fn(() => ({ limit: anomalyLimit }));
		const anomalyWhere = vi.fn(() => ({ orderBy: anomalyOrderBy }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: anomalyWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listSafetyAnomalies({
			anomalyCode: null,
			cursor: null,
			limit: 1,
			selectedTarget: null,
			severity: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.anomalies).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				detectedAt: "2026-04-01T10:00:00.000Z",
				requestId: "req_01",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				detectedAt: "2026-04-01T09:00:00.000Z",
				requestId: "req_02",
			}),
		);
		expect(anomalyLimit).toHaveBeenCalledWith(2);
	});
}

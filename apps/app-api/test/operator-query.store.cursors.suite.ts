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
				requestedTool: "knowledge_query",
				requestedScopeJson: null,
				requestId: "req_01",
				resolvedScopeJson: null,
				selectedTool: "knowledge_query",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "campus_web",
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
				requestedTool: "knowledge_query",
				requestedScopeJson: null,
				requestId: "req_02",
				resolvedScopeJson: null,
				selectedTool: "knowledge_query",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "campus_web",
				traceId: "trace_02",
				updatedAt: new Date("2026-04-01T09:00:02.000Z"),
				versionQueryJson: null,
			},
		];
		const requestLimit = vi.fn().mockResolvedValue(requestRows);
		const requestOrderBy = vi.fn(() => ({ limit: requestLimit }));
		const runBacklinkLimit = vi.fn().mockResolvedValue([]);
		const runBacklinkWhere = vi.fn(() => ({ limit: runBacklinkLimit }));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: requestOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: runBacklinkWhere,
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
	it("attaches durable run backlinks to request list projections", async () => {
		const requestRows = [
			{
				answerPreview: "First answer",
				completedAt: new Date("2026-04-01T10:00:01.000Z"),
				conversationId: "conv_01",
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				entitlementGroupsJson: ["students"],
				entitlementSnapshotId: null,
				principalId: "student_01",
				principalLabel: "Student One",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				questionPreview: "First question",
				requestedTool: "knowledge_query",
				requestedScopeJson: null,
				requestId: "req_01",
				resolvedScopeJson: null,
				selectedTool: "knowledge_query",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "campus_web",
				traceId: "trace_01",
				versionQueryJson: null,
			},
			{
				answerPreview: "Second answer",
				completedAt: new Date("2026-04-01T09:00:01.000Z"),
				conversationId: "conv_02",
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				entitlementGroupsJson: ["students"],
				entitlementSnapshotId: null,
				principalId: "student_02",
				principalLabel: "Student Two",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T09:00:02.000Z"),
				questionPreview: "Second question",
				requestedTool: "knowledge_query",
				requestedScopeJson: null,
				requestId: "req_02",
				resolvedScopeJson: null,
				selectedTool: "knowledge_query",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "campus_web",
				traceId: "trace_02",
				versionQueryJson: null,
			},
		];
		const requestLimit = vi.fn().mockResolvedValue(requestRows);
		const requestOrderBy = vi.fn(() => ({ limit: requestLimit }));
		const runLimit = vi.fn().mockResolvedValue([
			{
				requestId: "req_01",
				runId: "run_01",
			},
			{
				requestId: "req_02",
				runId: null,
			},
		]);
		const runWhere = vi.fn(() => ({ limit: runLimit }));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: requestOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: runWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.list({
			conversationId: null,
			cursor: null,
			limit: 2,
			q: null,
			requestId: null,
			status: null,
			surface: null,
		});

		expect(result.requests.map((request) => [request.requestId, request.runId])).toEqual([
			["req_01", "run_01"],
			["req_02", null],
		]);
		expect(runWhere).toHaveBeenCalledTimes(1);
	});
}

import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreQualitySuite(ctx: OperatorQueryStoreSuiteContext): void {
	const {
		createPgOperatorQueryStore,
		createRuntimeDatabase,
		encodeBase64UrlJson,
		resetOperatorQueryStoreMocks,
	} = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("applies quality badcase cursor filters before ordering the next page", async () => {
		const cursor = encodeBase64UrlJson({
			badcaseId: "badcase_02",
			openedAt: "2026-04-01T09:00:00.000Z",
		});
		const badcaseLimit = vi.fn().mockResolvedValue([]);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const badcaseWhere = vi.fn(() => ({ orderBy: badcaseOrderBy }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: badcaseOrderBy,
				where: badcaseWhere,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		await store.listQualityBadcases({
			causeClass: null,
			cursor,
			detectedBy: null,
			limit: 10,
			selectedTarget: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(badcaseWhere).toHaveBeenCalledTimes(1);
	});
	it("attaches intent grades to intent classifier badcases", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_intent_01",
				selectedTarget: "navigation-agent",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
				traceId: "trace_intent_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_intent_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

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
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
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
			limit: 10,
			selectedTarget: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases[0]?.grade).toEqual({
			graderVersion: "intent-grader@2026-04-20",
			result: "fail",
			score: 0.12,
		});
	});
	it("keeps same-request badcase grades scoped to each inferred quality domain", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_citation_01",
				causeClass: "citation_missing",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_shared_01",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "Citation missing",
				surface: "public_chat_web",
				traceId: "trace_shared_01",
			},
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:59:00.000Z"),
				requestId: "req_shared_01",
				selectedTarget: "navigation-agent",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
				traceId: "trace_shared_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
			{
				gradeDomain: "citation",
				gradeId: "grade_citation_01",
				graderVersion: "citation-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:01.000Z"),
				scoreMilli: 900,
				verdict: "pass",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

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
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
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
			limit: 10,
			selectedTarget: null,
			status: null,
			surface: null,
			window: null,
		});

		expect(result.badcases).toEqual([
			expect.objectContaining({
				badcaseId: "badcase_citation_01",
				grade: {
					graderVersion: "citation-grader@2026-04-20",
					result: "pass",
					score: 0.9,
				},
			}),
			expect.objectContaining({
				badcaseId: "badcase_intent_01",
				grade: {
					graderVersion: "intent-grader@2026-04-20",
					result: "fail",
					score: 0.12,
				},
			}),
		]);
	});
}

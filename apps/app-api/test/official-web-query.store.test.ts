// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { encodeBase64UrlJson } from "../src/base64url";
import { createPgOfficialWebQueryStore } from "../src/modules/official-web-query";

describe("official web query store", () => {
	it("returns opaque run cursors for the last visible row", async () => {
		const rows = [
			{
				artifactsJson: [],
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				failureCount: 0,
				finishedAt: new Date("2026-04-01T10:30:00.000Z"),
				ingestionDispatchRef: null,
				ingestionDispatchStatus: "dispatched",
				ingestionExecutionErrorCode: null,
				ingestionExecutionErrorMessage: null,
				ingestionExecutionRef: null,
				ingestionExecutionStatus: "pending",
				ingestionExecutionUpdatedAt: null,
				lastHeartbeatAt: new Date("2026-04-01T10:15:00.000Z"),
				projectedAt: new Date("2026-04-01T10:31:00.000Z"),
				runId: "owrun_01",
				runIntent: "baseline",
				siteId: "www_muc_edu_cn",
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				summaryJson: null,
			},
			{
				artifactsJson: [],
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				failureCount: 0,
				finishedAt: new Date("2026-04-01T09:30:00.000Z"),
				ingestionDispatchRef: null,
				ingestionDispatchStatus: "dispatched",
				ingestionExecutionErrorCode: null,
				ingestionExecutionErrorMessage: null,
				ingestionExecutionRef: null,
				ingestionExecutionStatus: "pending",
				ingestionExecutionUpdatedAt: null,
				lastHeartbeatAt: new Date("2026-04-01T09:15:00.000Z"),
				projectedAt: new Date("2026-04-01T09:31:00.000Z"),
				runId: "owrun_02",
				runIntent: "hot",
				siteId: "www_muc_edu_cn",
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				summaryJson: null,
			},
		];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					orderBy,
				})),
			})),
		};

		const store = createPgOfficialWebQueryStore({} as never, {
			getDb: () => db as never,
		});
		const result = await store.listRuns({
			cursor: null,
			ingestionDispatchStatus: null,
			limit: 1,
			runIntent: null,
			siteId: null,
			startedAfter: null,
			startedBefore: null,
			status: null,
		});

		expect(result.runs).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				runId: "owrun_01",
				startedAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				runId: "owrun_02",
				startedAt: "2026-04-01T09:00:00.000Z",
			}),
		);
	});
});

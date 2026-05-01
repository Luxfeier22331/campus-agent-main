// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { officialWebTargetJobs, officialWebTargetPageAttempts } from "../src/db/schema";
import {
	createPgOfficialWebCommandStore,
	type FinalizeOfficialWebRunWrite,
} from "../src/modules/official-web-command/store";

function buildFinalizeWrite(
	overrides: Partial<FinalizeOfficialWebRunWrite> = {},
): FinalizeOfficialWebRunWrite {
	return {
		artifacts: [],
		observations: [
			{
				cadenceClass: "target_candidate",
				changeStatus: "new",
				contentType: "text/html",
				discoveredFromUrl: null,
				discoveryMethod: "manual_requeue",
				etag: null,
				fetchDisposition: "fetched",
				finalUrl: "https://xxgk.muc.edu.cn/index.htm",
				freshness: {
					lastChangedAt: "2026-05-01T08:00:00.000Z",
					lastNotModifiedAt: null,
					lastSuccessfulRunId: "owrun_target",
					mainContentHash: "main-1",
					responseBodyHash: "body-1",
				},
				host: "xxgk.muc.edu.cn",
				httpStatus: 200,
				lastChangeReason: "target_candidate_admitted",
				lastModified: null,
				mainContentHash: "main-1",
				nextEligibleFetchAt: "2026-05-01T09:00:00.000Z",
				normalizedCanonicalUrl: "https://xxgk.muc.edu.cn/index.htm",
				observationId: "owobs_target_complete",
				observedAt: "2026-05-01T08:00:00.000Z",
				pageFamily: "target_candidate",
				pageTitleNormalized: "信息公开",
				priorityScore: 100,
				rawAssetId: "raw_target",
				rawVersionId: "rawv_target",
				requestedUrl: "https://xxgk.muc.edu.cn/index.htm",
				responseBodyHash: "body-1",
				runId: "owrun_target",
				runIntent: "hot",
				siteId: "muc_public",
				targetCandidateId: "owcand_contact",
				targetDeclarationVersion: "muc_public_target_source_map_v2",
				targetId: "campus-services-contact-directory",
				targetJobId: "owtarget_contact",
			},
			{
				cadenceClass: "target_candidate",
				changeStatus: "new",
				contentType: "text/html",
				discoveredFromUrl: null,
				discoveryMethod: "manual_requeue",
				etag: null,
				fetchDisposition: "fetched",
				finalUrl: "https://xxgk.muc.edu.cn/broken.htm",
				freshness: {
					lastChangedAt: "2026-05-01T08:00:00.000Z",
					lastNotModifiedAt: null,
					lastSuccessfulRunId: "owrun_target",
					mainContentHash: "main-2",
					responseBodyHash: "body-2",
				},
				host: "xxgk.muc.edu.cn",
				httpStatus: 200,
				lastChangeReason: "target_candidate_admitted",
				lastModified: null,
				mainContentHash: "main-2",
				nextEligibleFetchAt: "2026-05-01T09:00:00.000Z",
				normalizedCanonicalUrl: "https://xxgk.muc.edu.cn/broken.htm",
				observationId: "owobs_target_incomplete",
				observedAt: "2026-05-01T08:00:00.000Z",
				pageFamily: "target_candidate",
				pageTitleNormalized: "Broken",
				priorityScore: 100,
				rawAssetId: "raw_broken",
				rawVersionId: "rawv_broken",
				requestedUrl: "https://xxgk.muc.edu.cn/broken.htm",
				responseBodyHash: "body-2",
				runId: "owrun_target",
				runIntent: "hot",
				siteId: "muc_public",
				targetCandidateId: null,
				targetDeclarationVersion: null,
				targetId: null,
				targetJobId: "owtarget_contact",
			},
		],
		outboxEvent: {
			attemptCount: 0,
			availableAt: "2026-05-01T08:01:00.000Z",
			eventId: "owevt_completed_target",
			eventType: "official_web.run.completed",
			lastError: null,
			occurredAt: "2026-05-01T08:01:00.000Z",
			payload: {},
			processedAt: null,
			runId: "owrun_target",
		},
		run: {
			collectorVersion: "official-web-collector@test",
			configVersion: "git:test",
			crawlPolicyVersion: "2026-05-01",
			finishedAt: "2026-05-01T08:01:00.000Z",
			hostSet: ["xxgk.muc.edu.cn"],
			ingestionDispatchRef: "owdispatch_target",
			ingestionDispatchStatus: "queued",
			ingestionDispatchedAt: "2026-05-01T08:01:00.000Z",
			ingestionExecutionErrorCode: null,
			ingestionExecutionErrorMessage: null,
			ingestionExecutionRef: null,
			ingestionExecutionStatus: "pending",
			ingestionExecutionUpdatedAt: null,
			lastHeartbeatAt: null,
			latestHeartbeatSequence: 0,
			runId: "owrun_target",
			runIntent: "hot",
			schedulerRunKey: "manual-target",
			seedSet: ["https://xxgk.muc.edu.cn/index.htm"],
			siteId: "muc_public",
			startFingerprintSha256: "start",
			startedAt: "2026-05-01T08:00:00.000Z",
			status: "completed",
			summary: null,
			terminalErrorCode: null,
			terminalErrorMessage: null,
			terminalPayloadSha256: "terminal",
			triggerType: "manual",
		},
		...overrides,
	};
}

describe("pg official web command store", () => {
	it("materializes target page attempts only when target lineage is complete", async () => {
		const inserts: Array<{ table: unknown; values: unknown }> = [];
		const updates: Array<{ set: Record<string, unknown>; table: unknown }> = [];
		const tx = {
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: unknown) => {
					inserts.push({ table, values });
					return {
						onConflictDoUpdate: vi.fn().mockResolvedValue([]),
					};
				}),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((set: Record<string, unknown>) => {
					updates.push({ set, table });
					return {
						where: vi.fn().mockResolvedValue([]),
					};
				}),
			})),
		};
		const db = {
			transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) =>
				callback(tx),
			),
		};
		const store = createPgOfficialWebCommandStore({} as never, {
			getDb: () => db as never,
		});

		await store.finalizeRun(buildFinalizeWrite());

		const targetAttemptInsert = inserts.find(
			(insert) => insert.table === officialWebTargetPageAttempts,
		);
		expect(targetAttemptInsert?.values).toEqual([
			expect.objectContaining({
				attemptId: "owattempt_owobs_target_complete",
				candidateId: "owcand_contact",
				jobId: "owtarget_contact",
				targetId: "campus-services-contact-directory",
			}),
		]);
		expect(updates.some((update) => update.table === officialWebTargetJobs)).toBe(true);
	});
});

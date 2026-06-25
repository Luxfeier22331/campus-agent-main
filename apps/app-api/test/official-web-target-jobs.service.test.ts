// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { appApiSchema, officialWebTargetJobs } from "../src/db/schema";
import { appApiOwnedSchema } from "../src/db/schema/owned";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildOfficialWebTargetJobService,
	type OfficialWebTargetJobRecord,
	type OfficialWebTargetJobStore,
} from "../src/modules/official-web-target-jobs";

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

const targetJob: OfficialWebTargetJobRecord = {
	artifactVerificationSummary: {
		canonicalVerification: false,
		objectVerificationId: null,
		sourceHandoffId: null,
		status: "projection_only",
		updatedAt: "2026-05-01T08:00:00.000Z",
	},
	attemptCount: 1,
	candidateCount: 2,
	consumerFamily: "academic_calendar_candidate",
	createdAt: "2026-05-01T08:00:00.000Z",
	declarationVersion: "muc_public_target_source_map_v2",
	id: "owtarget_muc_public_calendar",
	idempotencyKey: "muc_public:muc_public_target_source_map_v2:official-web-academic-calendar",
	inventoryOnly: false,
	latestRunId: null,
	materializationPolicy: "candidate_only",
	ownerSurface: "calendar/academic_calendar",
	requiredEvidence: ["calendar_arrangement"],
	retentionPolicy: "retain_source_truth",
	reviewPolicy: "selected_write_requires_review",
	selectedWriteTarget: "calendar/academic_calendar",
	siteId: "muc_public",
	sourceHosts: ["www.muc.edu.cn"],
	status: "declared",
	targetId: "official-web-academic-calendar",
	titleHints: ["校历"],
	updatedAt: "2026-05-01T08:00:00.000Z",
	urlHints: ["calendar"],
};

describe("official web target job service", () => {
	it("exports target job tables through the unified app-api schema", () => {
		expect(appApiSchema.officialWebTargetJobs).toBe(officialWebTargetJobs);
	});

	it("exports target job tables through the app-api owned schema for migration management", () => {
		expect(appApiOwnedSchema.officialWebTargetJobs).toBe(officialWebTargetJobs);
	});

	it("lists operator-safe target jobs with projection-only verification summaries", async () => {
		const store: OfficialWebTargetJobStore = {
			getTargetJobById: vi.fn(),
			listTargetJobs: vi.fn().mockResolvedValue({
				jobs: [targetJob],
				page: { nextCursor: null },
			}),
			upsertDeclaredTargetJobs: vi.fn(),
		};
		const service = buildOfficialWebTargetJobService({ store });

		const result = await service.listTargetJobs({
			filters: { limit: 10, siteId: "muc_public" },
			principal: createOperatorPrincipal(),
		});

		expect(result.jobs).toEqual([targetJob]);
		expect(result.jobs[0]?.artifactVerificationSummary).toMatchObject({
			canonicalVerification: false,
			status: "projection_only",
		});
		expect(store.listTargetJobs).toHaveBeenCalledWith({
			cursor: null,
			limit: 10,
			siteId: "muc_public",
			status: null,
			targetId: null,
		});
	});

	it("creates deterministic declared target jobs from frozen target declarations", async () => {
		const store: OfficialWebTargetJobStore = {
			getTargetJobById: vi.fn(),
			listTargetJobs: vi.fn(),
			upsertDeclaredTargetJobs: vi.fn().mockResolvedValue([targetJob]),
		};
		const service = buildOfficialWebTargetJobService({
			now: () => new Date("2026-05-01T08:00:00.000Z"),
			store,
		});

		await service.upsertDeclaredTargetJobs({
			declarationVersion: "muc_public_target_source_map_v2",
			siteId: "muc_public",
			targets: [
				{
					consumerFamily: "academic_calendar_candidate",
					inventoryOnly: false,
					materializationPolicy: "candidate_only",
					ownerSurface: "calendar/academic_calendar",
					requiredEvidence: ["calendar_arrangement"],
					retentionPolicy: "retain_source_truth",
					reviewPolicy: "selected_write_requires_review",
					selectedWriteTarget: "calendar/academic_calendar",
					sourceHosts: ["www.muc.edu.cn"],
					targetId: "official-web-academic-calendar",
					titleHints: ["校历"],
					urlHints: ["calendar"],
				},
			],
		});

		expect(store.upsertDeclaredTargetJobs).toHaveBeenCalledWith([
			expect.objectContaining({
				declarationVersion: "muc_public_target_source_map_v2",
				idempotencyKey: "muc_public:muc_public_target_source_map_v2:official-web-academic-calendar",
				status: "declared",
				targetId: "official-web-academic-calendar",
			}),
		]);
	});

	it("loads target job detail with candidates, attempts and verification summaries", async () => {
		const detail = {
			artifactVerificationSummaries: [
				{
					canonicalVerification: true,
					objectVerificationId: "objver_01",
					runId: "owrun_01",
					sourceHandoffId: "handoff_01",
					status: "verified",
					summary: {
						checkedObjects: 3,
					},
					summaryId: "owsummary_01",
					updatedAt: "2026-05-01T08:10:00.000Z",
				},
			],
			attempts: [
				{
					artifactCaptured: true,
					attemptId: "owattempt_01",
					attemptStatus: "completed",
					attemptedAt: "2026-05-01T08:05:00.000Z",
					candidateId: "owcand_01",
					completedAt: "2026-05-01T08:05:30.000Z",
					httpStatus: 200,
					normalizedCanonicalUrl: "https://www.muc.edu.cn/contact",
					runId: "owrun_01",
				},
			],
			candidates: [
				{
					candidateId: "owcand_01",
					createdAt: "2026-05-01T08:00:00.000Z",
					eligibilityReason: "url_hint_match",
					normalizedCandidateUrl: "https://www.muc.edu.cn/contact",
					priorityScore: 90,
					sourceHost: "www.muc.edu.cn",
					status: "eligible",
					titleHint: "联系",
					updatedAt: "2026-05-01T08:00:00.000Z",
					urlHint: "contact",
				},
			],
			job: targetJob,
		};
		const store: OfficialWebTargetJobStore = {
			getTargetJobById: vi.fn().mockResolvedValue(detail),
			listTargetJobs: vi.fn(),
			upsertDeclaredTargetJobs: vi.fn(),
		};
		const service = buildOfficialWebTargetJobService({ store });

		await expect(
			service.getTargetJobById({
				jobId: " owtarget_muc_public_calendar ",
				principal: createOperatorPrincipal(),
			}),
		).resolves.toEqual(detail);
		expect(store.getTargetJobById).toHaveBeenCalledWith("owtarget_muc_public_calendar");
	});

	it("fails closed when target job detail is missing", async () => {
		const store: OfficialWebTargetJobStore = {
			getTargetJobById: vi.fn().mockResolvedValue(null),
			listTargetJobs: vi.fn(),
			upsertDeclaredTargetJobs: vi.fn(),
		};
		const service = buildOfficialWebTargetJobService({ store });

		await expect(
			service.getTargetJobById({
				jobId: "missing",
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "target_job_not_found",
			status: 404,
		});
	});
});

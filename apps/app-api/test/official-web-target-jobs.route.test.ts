// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebTargetJobService } from "../src/modules/official-web-target-jobs";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

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

describe("official web target job operator route", () => {
	it("lists target jobs through app-api without object-store access", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebTargetJobService = {
			listTargetJobs: vi.fn().mockResolvedValue({
				jobs: [
					{
						artifactVerificationSummary: {
							canonicalVerification: false,
							objectVerificationId: null,
							sourceHandoffId: null,
							status: "projection_only",
							updatedAt: "2026-05-01T08:00:00.000Z",
						},
						attemptCount: 1,
						candidateCount: 2,
						consumerFamily: "contact_directory_candidate",
						createdAt: "2026-05-01T08:00:00.000Z",
						declarationVersion: "muc_public_target_source_map_v2",
						id: "owtarget_muc_public_contact",
						idempotencyKey:
							"muc_public:muc_public_target_source_map_v2:campus-services-contact-directory",
						inventoryOnly: false,
						latestRunId: null,
						materializationPolicy: "candidate_only",
						ownerSurface: "contact_directory_lookup",
						requiredEvidence: ["phone", "location"],
						retentionPolicy: "retain_source_truth",
						reviewPolicy: "selected_write_requires_review",
						selectedWriteTarget: "campus_services/contact_directory",
						siteId: "muc_public",
						sourceHosts: ["www.muc.edu.cn"],
						status: "declared",
						targetId: "campus-services-contact-directory",
						titleHints: ["联系"],
						updatedAt: "2026-05-01T08:00:00.000Z",
						urlHints: ["contact"],
					},
				],
				page: { nextCursor: null },
			}),
			getTargetJobById: vi.fn().mockResolvedValue({
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
				job: {
					artifactVerificationSummary: {
						canonicalVerification: true,
						objectVerificationId: "objver_01",
						sourceHandoffId: "handoff_01",
						status: "verified",
						updatedAt: "2026-05-01T08:10:00.000Z",
					},
					attemptCount: 1,
					candidateCount: 2,
					consumerFamily: "contact_directory_candidate",
					createdAt: "2026-05-01T08:00:00.000Z",
					declarationVersion: "muc_public_target_source_map_v2",
					id: "owtarget_muc_public_contact",
					idempotencyKey:
						"muc_public:muc_public_target_source_map_v2:campus-services-contact-directory",
					inventoryOnly: false,
					latestRunId: "owrun_01",
					materializationPolicy: "candidate_only",
					ownerSurface: "contact_directory_lookup",
					requiredEvidence: ["phone", "location"],
					retentionPolicy: "retain_source_truth",
					reviewPolicy: "selected_write_requires_review",
					selectedWriteTarget: "campus_services/contact_directory",
					siteId: "muc_public",
					sourceHosts: ["www.muc.edu.cn"],
					status: "active",
					targetId: "campus-services-contact-directory",
					titleHints: ["联系"],
					updatedAt: "2026-05-01T08:10:00.000Z",
					urlHints: ["contact"],
				},
			}),
			upsertDeclaredTargetJobs: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebTargetJobService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/target-jobs?siteId=muc_public&limit=5",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			jobs: [
				expect.objectContaining({
					artifactVerificationSummary: expect.objectContaining({
						canonicalVerification: false,
						status: "projection_only",
					}),
					targetId: "campus-services-contact-directory",
				}),
			],
			page: { nextCursor: null },
		});
		expect(service.listTargetJobs).toHaveBeenCalledWith({
			filters: {
				cursor: null,
				limit: 5,
				siteId: "muc_public",
				status: null,
				targetId: null,
			},
			principal,
		});

		const detailResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/target-jobs/owtarget_muc_public_contact",
			),
		);

		expect(detailResponse.status).toBe(200);
		await expect(detailResponse.json()).resolves.toEqual({
			targetJob: expect.objectContaining({
				attempts: [
					expect.not.objectContaining({
						artifactObjectKey: expect.anything(),
					}),
				],
				candidates: [
					expect.objectContaining({
						normalizedCandidateUrl: "https://www.muc.edu.cn/contact",
					}),
				],
				job: expect.objectContaining({
					attemptCount: 1,
					targetId: "campus-services-contact-directory",
				}),
			}),
		});
		expect(service.getTargetJobById).toHaveBeenCalledWith({
			jobId: "owtarget_muc_public_contact",
			principal,
		});
	});
});

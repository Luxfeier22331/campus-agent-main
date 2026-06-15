import { expect, it, vi } from "vitest";

import { operatorConsoleDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

export function registerDataProviderOfficialWebSuitePart01() {
	it("does not expose selected-write admission, intervention, approve, or queue helpers", () => {
		const provider = operatorConsoleDataProvider as Record<string, unknown>;
		expect("getOfficialWebSelectedWriteAdmission" in provider).toBe(false);
		expect("recordOfficialWebSelectedWriteIntervention" in provider).toBe(false);
		expect("createOfficialWebSelectedWriteGate" in provider).toBe(false);
		expect("requestOfficialWebSelectedWriteExecution" in provider).toBe(false);
	});

	it("maps official web target inventory filters onto the protected app-api projection seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				entries: [
					{
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						fieldStatus: {
							process_steps: "missing",
						},
						id: "muc-information-disclosure-application-process",
						inventoryId: "muc-information-disclosure-application-process",
						ownerSurface: "service_guide_lookup",
						optionalEvidence: ["service_material"],
						optionalFields: ["required_materials"],
						previewEvidence: null,
						releaseBlockers: ["no_preview_evidence"],
						requiredEvidence: ["service_process"],
						requiredFields: ["process_steps"],
						reviewState: "candidate",
						selectedWriteTarget: "campus_services/service_guide",
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "中央民族大学信息公开依申请公开工作流程",
					},
				],
				page: {
					nextCursor: null,
				},
				summary: {
					countsByReviewState: { candidate: 1 },
					inventoryVersion: "muc_public_target_inventory_v1",
					siteId: "muc_public",
				},
			}),
		);

		const response = await operatorConsoleDataProvider.getList("officialWebTargetInventory", {
			filter: {
				ownerSurface: "service_guide_lookup",
				reviewState: "candidate",
				siteId: "muc_public",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "inventoryId",
				order: "ASC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: "muc-information-disclosure-application-process",
			inventoryId: "muc-information-disclosure-application-process",
			reviewState: "candidate",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/target-inventory?limit=20&ownerSurface=service_guide_lookup&reviewState=candidate&siteId=muc_public",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps official web target job filters onto the protected app-api projection seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
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
						updatedAt: "2026-05-01T08:00:00.000Z",
						urlHints: ["contact"],
					},
				],
				page: {
					nextCursor: "cursor_target_jobs_02",
				},
			}),
		);

		const response = await operatorConsoleDataProvider.getList("officialWebTargetJobs", {
			filter: {
				siteId: "muc_public",
				status: "active",
				targetId: "campus-services-contact-directory",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "updatedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			attemptCount: 1,
			candidateCount: 2,
			id: "owtarget_muc_public_contact",
			targetId: "campus-services-contact-directory",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/target-jobs?limit=20&siteId=muc_public&status=active&targetId=campus-services-contact-directory",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps official web release task filters onto the protected app-api projection seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				page: {
					nextCursor: null,
				},
				tasks: [
					{
						attemptCount: 1,
						createdAt: "2026-05-01T08:00:00.000Z",
						freshnessStatus: "fresh",
						id: "owrelease_contact",
						inputSummary: {
							sourceObjectCount: 1,
						},
						inventoryId: "muc-main-homepage-contact",
						jobId: "owtarget_contact",
						lastErrorCode: null,
						lastErrorMessage: null,
						latestStage: "published",
						lifecycleStatus: "published",
						maxAttempts: 3,
						observedAgeSeconds: 0,
						outputSummary: {
							fullImpactDisplayNames: ["中央民族大学", "中央民族大学信息公开联系方式"],
							fullRecordCount: 2,
							recordCount: 1,
							releaseId: "release_contact",
							taskScopeDisplayNames: ["中央民族大学信息公开联系方式"],
						},
						producerVersion: "test@1",
						projectedAt: "2026-05-01T08:03:00.000Z",
						redactionVersion: "official_web_release_task_redaction.v1",
						runId: "owrun_contact",
						schemaVersion: "official_web_release_task_projection.v1",
						selectedWriteTarget: "campus_services/contact_directory",
						sourceChannel: "official_web",
						staleAfterSeconds: 1800,
						staleReasonCode: null,
						taskId: "owrelease_contact",
						taskType: "official_web_selected_write_contact_directory",
						timeline: [],
						updatedAt: "2026-05-01T08:03:00.000Z",
					},
				],
			}),
		);

		const response = await operatorConsoleDataProvider.getList("officialWebReleaseTasks", {
			filter: {
				inventoryId: "muc-main-homepage-contact",
				q: "contact",
				selectedWriteTarget: "campus_services/contact_directory",
				status: "published",
				taskType: "official_web_selected_write_contact_directory",
			},
			meta: undefined,
			pagination: {
				page: 1,
				perPage: 20,
			},
			signal: undefined,
			sort: {
				field: "projectedAt",
				order: "DESC",
			},
		});

		expect(response.data[0]).toMatchObject({
			id: "owrelease_contact",
			lifecycleStatus: "published",
			taskId: "owrelease_contact",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/release-tasks?limit=20&inventoryId=muc-main-homepage-contact&q=contact&selectedWriteTarget=campus_services%2Fcontact_directory&status=published&taskType=official_web_selected_write_contact_directory",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads official web release task detail through the protected app-api projection seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				task: {
					attemptCount: 1,
					createdAt: "2026-05-01T08:00:00.000Z",
					freshnessStatus: "fresh",
					id: "owrelease_contact",
					inputSummary: {},
					inventoryId: "muc-main-homepage-contact",
					jobId: "owtarget_contact",
					lastErrorCode: null,
					lastErrorMessage: null,
					latestStage: "published",
					lifecycleStatus: "published",
					maxAttempts: 3,
					observedAgeSeconds: 0,
					outputSummary: {
						fullImpactDisplayNames: ["中央民族大学", "中央民族大学信息公开联系方式"],
						fullRecordCount: 2,
						releaseId: "release_contact",
						taskScopeDisplayNames: ["中央民族大学信息公开联系方式"],
					},
					producerVersion: "test@1",
					projectedAt: "2026-05-01T08:03:00.000Z",
					redactionVersion: "official_web_release_task_redaction.v1",
					runId: "owrun_contact",
					schemaVersion: "official_web_release_task_projection.v1",
					selectedWriteTarget: "campus_services/contact_directory",
					sourceChannel: "official_web",
					staleAfterSeconds: 1800,
					staleReasonCode: null,
					taskId: "owrelease_contact",
					taskType: "official_web_selected_write_contact_directory",
					timeline: [],
					updatedAt: "2026-05-01T08:03:00.000Z",
				},
			}),
		);

		const response = await operatorConsoleDataProvider.getOne("officialWebReleaseTasks", {
			id: "owrelease/contact",
			meta: undefined,
			signal: undefined,
		});

		expect(response.data).toMatchObject({
			id: "owrelease_contact",
			taskId: "owrelease_contact",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/release-tasks/owrelease%2Fcontact",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("loads official web target job detail without exposing object-store keys", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				targetJob: {
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
				},
			}),
		);

		await expect(
			operatorConsoleDataProvider.getOne("officialWebTargetJobs", {
				id: "owtarget/muc public?debug=true#frag",
				meta: undefined,
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
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
				id: "owtarget_muc_public_contact",
				job: expect.objectContaining({
					targetId: "campus-services-contact-directory",
				}),
			},
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/official-web/target-jobs/owtarget%2Fmuc%20public%3Fdebug%3Dtrue%23frag",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
}

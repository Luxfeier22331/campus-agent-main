// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { OfficialWebCollectorPrincipal } from "../src/modules/auth";
import {
	buildOfficialWebPlannerService,
	type OfficialWebPlannerPageCandidate,
	type OfficialWebPlannerStore,
} from "../src/modules/official-web-planner";
import { __officialWebPlannerStoreTestUtils } from "../src/modules/official-web-planner/store";

const collectorPrincipal: OfficialWebCollectorPrincipal = {
	kind: "service",
	serviceClass: "official_web_collector",
	serviceId: "official-web-collector",
};

function buildTargetCandidate(
	overrides: Partial<OfficialWebPlannerPageCandidate> = {},
): OfficialWebPlannerPageCandidate {
	return {
		cadenceClass: "target_candidate",
		consumerFamily: "contact_directory_candidate",
		contentType: "text/html",
		discoveredFromUrl: null,
		discoveryMethod: "manual_requeue",
		etag: null,
		fetchProfile: "target_candidate_fetch",
		host: "www.muc.edu.cn",
		hostPolicy: {
			host: "www.muc.edu.cn",
			sourceHost: "www.muc.edu.cn",
		},
		inventoryOnly: false,
		lastChangeReason: "target_candidate_admitted",
		lastChangedAt: null,
		lastFetchDisposition: "never_fetched",
		lastHttpStatus: null,
		lastModified: null,
		lastNotModifiedAt: null,
		lastSeenAt: "2026-05-01T08:00:00.000Z",
		lastSuccessfulRunId: null,
		mainContentHash: null,
		materializationPolicy: "candidate_only",
		nextEligibleFetchAt: "2026-05-01T08:00:00.000Z",
		normalizedCanonicalUrl: "https://www.muc.edu.cn/contact/",
		pageFamily: "target_candidate",
		pageTitleNormalized: "",
		priorityScore: 80,
		responseBodyHash: null,
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "selected_write_requires_review",
		selectedWriteTarget: "campus_services/contact_directory",
		siteId: "muc_public",
		targetCandidateId: "owcand_contact",
		targetDeclarationVersion: "muc_public_target_source_map_v2",
		targetId: "campus-services-contact-directory",
		targetJobId: "owtarget_contact",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

describe("official web planner service", () => {
	it("chooses candidate or job title hints when freshness title is missing", () => {
		expect(
			__officialWebPlannerStoreTestUtils.resolvePlannerPageTitle({
				freshnessTitle: "",
				candidateTitleHint: "校历查看方式",
				jobTitleHints: ["办理", "指南"],
			}),
		).toBe("校历查看方式");

		expect(
			__officialWebPlannerStoreTestUtils.resolvePlannerPageTitle({
				freshnessTitle: "民大校历",
				candidateTitleHint: "校历查看方式",
				jobTitleHints: ["办理", "指南"],
			}),
		).toBe("民大校历");

		expect(
			__officialWebPlannerStoreTestUtils.resolvePlannerPageTitle({
				freshnessTitle: "",
				candidateTitleHint: "",
				jobTitleHints: ["办理", "指南"],
			}),
		).toBe("办理");
	});

	it("keeps same-url target candidates together when explicit target candidates are requested", () => {
		const rows = [
			buildTargetCandidate({
				host: "www.muc.edu.cn",
				normalizedCanonicalUrl: "https://www.muc.edu.cn/xxgk1/xxjj.htm",
				targetCandidateId: "owcand_stable",
				targetId: "official-web-stable-reference",
				targetJobId: "owtarget_stable",
			}),
			buildTargetCandidate({
				host: "www.muc.edu.cn",
				consumerFamily: "contact_directory_candidate",
				normalizedCanonicalUrl: "https://www.muc.edu.cn/xxgk1/xxjj.htm",
				selectedWriteTarget: "campus_services/contact_directory",
				targetCandidateId: "owcand_contact",
				targetId: "campus-services-contact-directory",
				targetJobId: "owtarget_contact",
			}),
			buildTargetCandidate({
				host: "xxgk.muc.edu.cn",
				normalizedCanonicalUrl: "https://xxgk.muc.edu.cn/info/1007/1113.htm",
				targetCandidateId: "owcand_service",
				targetId: "campus-services-service-guide",
				targetJobId: "owtarget_service",
			}),
		];

		const selected = __officialWebPlannerStoreTestUtils.selectBudgetedRows(
			rows,
			{
				hostFilter: ["www.muc.edu.cn", "xxgk.muc.edu.cn"],
				maxPagesPerHost: 1,
				maxTotalPages: 2,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
				targetCandidateIds: ["owcand_stable", "owcand_contact", "owcand_service"],
			},
			{ dedupeByCanonicalUrl: true },
		);

		expect(selected).toHaveLength(3);
		expect(selected.map((row) => row.targetCandidateId)).toEqual([
			"owcand_stable",
			"owcand_contact",
			"owcand_service",
		]);
	});

	it("returns target-scoped workset rows and summary", async () => {
		const candidate = buildTargetCandidate();
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([candidate]),
		};
		const service = buildOfficialWebPlannerService({ store });

		const result = await service.resolve({
			payload: {
				hostFilter: ["www.muc.edu.cn"],
				maxPagesPerHost: 10,
				maxTotalPages: 40,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
			},
			principal: collectorPrincipal,
		});

		expect(result.plan.duePages).toEqual([candidate]);
		expect(result.plan.summary).toMatchObject({
			duePages: 1,
			selectedHosts: 1,
			targetJobs: 1,
			worksetRows: 1,
		});
		expect(store.listDuePages).toHaveBeenCalledWith({
			hostFilter: ["www.muc.edu.cn"],
			maxPagesPerHost: 10,
			maxTotalPages: 40,
			now: "2026-05-01T09:00:00.000Z",
			runIntent: "hot",
			siteId: "muc_public",
			targetCandidateIds: [],
		});
	});

	it("forwards target candidate filters for exclusive dry-run worksets", async () => {
		const candidate = buildTargetCandidate({
			targetCandidateId: "owcand_requested",
		});
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([candidate]),
		};
		const service = buildOfficialWebPlannerService({ store });

		await service.resolve({
			payload: {
				hostFilter: ["www.muc.edu.cn"],
				maxPagesPerHost: 1,
				maxTotalPages: 1,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
				targetCandidateIds: ["owcand_requested"],
			},
			principal: collectorPrincipal,
		});

		expect(store.listDuePages).toHaveBeenCalledWith(
			expect.objectContaining({
				targetCandidateIds: ["owcand_requested"],
			}),
		);
	});

	it("keeps explicitly requested deleted candidates eligible for requeue", () => {
		const rows = [
			buildTargetCandidate({
				host: "met.muc.edu.cn",
				lastFetchDisposition: "deleted",
				normalizedCanonicalUrl: "https://met.muc.edu.cn/info/1068/1832.htm",
				targetCandidateId: "owcand_deleted",
				targetId: "campus-services-service-guide",
				targetJobId: "owtarget_service_guide",
			}),
			buildTargetCandidate({
				host: "met.muc.edu.cn",
				normalizedCanonicalUrl: "https://met.muc.edu.cn/info/1068/1830.htm",
				targetCandidateId: "owcand_live",
				targetId: "campus-services-service-guide",
				targetJobId: "owtarget_service_guide",
			}),
		];

		const selected = __officialWebPlannerStoreTestUtils.selectBudgetedRows(
			rows,
			{
				hostFilter: ["met.muc.edu.cn"],
				maxPagesPerHost: 10,
				maxTotalPages: 10,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
				targetCandidateIds: ["owcand_deleted", "owcand_live"],
			},
			{ dedupeByCanonicalUrl: true },
		);

		expect(selected.map((row) => row.targetCandidateId)).toEqual(["owcand_deleted", "owcand_live"]);
	});

	it("bypasses freshness due gating for explicit target candidate worksets", () => {
		expect(
			__officialWebPlannerStoreTestUtils.shouldApplyFreshnessDueFilter({
				targetCandidateIds: [],
			}),
		).toBe(true);

		expect(
			__officialWebPlannerStoreTestUtils.shouldApplyFreshnessDueFilter({
				targetCandidateIds: ["owcand_explicit"],
			}),
		).toBe(false);
	});

	it("accepts regulation_candidate workset rows for institutional-rules targets", async () => {
		const candidate = buildTargetCandidate({
			consumerFamily: "regulation_candidate",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/institutional_rules",
			targetCandidateId: "owcand_institutional_rule",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_institutional_rules",
		});
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([candidate]),
		};
		const service = buildOfficialWebPlannerService({ store });

		const result = await service.resolve({
			payload: {
				hostFilter: ["xxgk.muc.edu.cn"],
				maxPagesPerHost: 1,
				maxTotalPages: 1,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
			},
			principal: collectorPrincipal,
		});

		expect(result.plan.duePages).toEqual([candidate]);
	});

	it("accepts student_regulation_candidate workset rows for student-rules targets", async () => {
		const candidate = buildTargetCandidate({
			consumerFamily: "student_regulation_candidate",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/student_rules",
			targetCandidateId: "owcand_student_rule",
			targetId: "official-web-student-rules",
			targetJobId: "owtarget_student_rules",
		});
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([candidate]),
		};
		const service = buildOfficialWebPlannerService({ store });

		const result = await service.resolve({
			payload: {
				hostFilter: ["xxgk.muc.edu.cn"],
				maxPagesPerHost: 1,
				maxTotalPages: 1,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
			},
			principal: collectorPrincipal,
		});

		expect(result.plan.duePages).toEqual([candidate]);
	});

	it("accepts academic_calendar_candidate workset rows for academic calendar targets", async () => {
		const candidate = buildTargetCandidate({
			consumerFamily: "academic_calendar_candidate",
			selectedWriteTarget: "calendar/academic_calendar",
			targetCandidateId: "owcand_academic_calendar",
			targetId: "official-web-academic-calendar",
			targetJobId: "owtarget_academic_calendar",
		});
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([candidate]),
		};
		const service = buildOfficialWebPlannerService({ store });

		const result = await service.resolve({
			payload: {
				hostFilter: ["jwc.muc.edu.cn"],
				maxPagesPerHost: 1,
				maxTotalPages: 1,
				now: "2026-05-01T09:00:00.000Z",
				runIntent: "hot",
				siteId: "muc_public",
			},
			principal: collectorPrincipal,
		});

		expect(result.plan.duePages).toEqual([candidate]);
	});

	it("rejects non-canonical target family names before returning a workset", async () => {
		const store: OfficialWebPlannerStore = {
			listDuePages: vi.fn().mockResolvedValue([
				buildTargetCandidate({
					consumerFamily: "public_notice_inventory",
					targetId: "bad-target",
					targetJobId: "bad-job",
				}),
			]),
		};
		const service = buildOfficialWebPlannerService({ store });

		await expect(
			service.resolve({
				payload: {
					hostFilter: [],
					maxPagesPerHost: 10,
					maxTotalPages: 40,
					now: "2026-05-01T09:00:00.000Z",
					runIntent: "baseline",
					siteId: "muc_public",
				},
				principal: collectorPrincipal,
			}),
		).rejects.toMatchObject({
			code: "invalid_workset",
			status: 500,
		});
	});
});

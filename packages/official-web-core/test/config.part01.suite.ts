import { expect, it } from "vitest";

import {
	buildOfficialWebCrawlPlan,
	buildOfficialWebSchedulerPlan,
	loadOfficialWebConfig,
	resolveOfficialWebConfigPaths,
} from "../src/index";

export function registerOfficialWebConfigPart01() {
	it("resolves muc_public repo-tracked config paths", () => {
		const paths = resolveOfficialWebConfigPaths("muc_public");

		expect(paths.siteRoot.endsWith("configs/sources/official_web/muc_public")).toBe(true);
		expect(paths.sitePath.endsWith("configs/sources/official_web/muc_public/site.json")).toBe(true);
		expect(paths.hostsPath.endsWith("configs/sources/official_web/muc_public/hosts.json")).toBe(
			true,
		);
		expect(paths.seedsPath.endsWith("configs/sources/official_web/muc_public/seeds.json")).toBe(
			true,
		);
		expect(
			paths.schedulerPolicyPath.endsWith(
				"configs/sources/official_web/muc_public/scheduler-policy.json",
			),
		).toBe(true);
		expect(
			paths.qcPolicyPath.endsWith("configs/sources/official_web/muc_public/qc-policy.json"),
		).toBe(true);
		expect(
			paths.targetSourceMapPath.endsWith(
				"configs/sources/official_web/muc_public/target-source-map.json",
			),
		).toBe(true);
		expect(
			paths.targetInventoryPath.endsWith(
				"configs/sources/official_web/muc_public/target-inventory.json",
			),
		).toBe(true);
		expect(
			paths.sourcePackManifestPath.endsWith(
				"configs/sources/official_web/muc_public/source-packs/tool-driven-first-slice.v1.json",
			),
		).toBe(true);
	});

	it("loads muc_public and builds a stable crawl plan", () => {
		const config = loadOfficialWebConfig("muc_public");
		const plan = buildOfficialWebCrawlPlan("muc_public", {
			crawlRunId: "muc_public-TEST",
			now: new Date("2026-03-28T16:00:00.000Z"),
		});
		const schedulerPlan = buildOfficialWebSchedulerPlan("muc_public", {
			now: new Date("2026-03-28T16:00:00.000Z"),
		});

		expect(config.site.siteId).toBe("muc_public");
		expect(config.site.sourceChannel).toBe("official_web");
		expect(config.site.allowedHosts).not.toContain("my.muc.edu.cn");
		expect(config.site.allowedHosts).not.toContain("service.muc.edu.cn");
		expect(config.hosts.hosts.filter((item) => item.enabled)).toHaveLength(34);
		expect(config.seeds.seeds).toHaveLength(34);
		expect(config.projectionDeclarations.declarations.length).toBeGreaterThan(0);
		expect(
			config.projectionDeclarations.declarations.find(
				(item) => item.pageFamily === "dynamic_shell_page",
			),
		).toMatchObject({
			action: "manual_review",
		});
		expect(config.qcPolicy.qcPolicyVersion).toBe("muc_public_qc_v1");
		expect(config.qcPolicy.allowedReviewIssueCodes).toContain(
			"shell_family_requires_manual_review",
		);
		expect(config.qcPolicy.allowedReviewPageFamilies).toContain("dynamic_shell_page");
		expect(config.schedulerPolicy.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(config.targetSourceMap.mapVersion).toBe("muc_public_target_source_map_v2");
		expect(config.targetSourceMap.targets.map((target) => target.targetId)).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
			"official-web-academic-calendar",
			"official-web-stable-reference",
			"official-web-institutional-rules",
			"official-web-student-rules",
			"official-web-notice-news-inventory",
		]);
		expect(config.targetSourceMap.targets[0]).toMatchObject({
			consumerFamily: "contact_directory_candidate",
			inventoryOnly: false,
			materializationPolicy: "candidate_only",
			optionalEvidence: ["email", "location", "office_hours"],
			requiredEvidence: ["phone"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "selected_write_requires_review",
			selectedWriteTarget: "campus_services/contact_directory",
			sourceHosts: ["www.muc.edu.cn", "xxgk.muc.edu.cn", "lib.muc.edu.cn", "met.muc.edu.cn"],
			titleHints: ["联系", "联系我们", "联系方式", "电话", "办公地点"],
			urlHints: ["contact", "lianxi", "lxwm", "bgs", "office"],
		});
		expect(config.targetSourceMap.targets[1]).toMatchObject({
			consumerFamily: "service_guide_candidate",
			optionalEvidence: ["service_entry", "service_material", "phone", "location", "office_hours"],
			requiredEvidence: ["service_process"],
			selectedWriteTarget: "campus_services/service_guide",
			sourceHosts: ["www.muc.edu.cn", "xxgk.muc.edu.cn", "lib.muc.edu.cn", "met.muc.edu.cn"],
			titleHints: expect.arrayContaining(["校园卡", "一卡通"]),
			urlHints: expect.arrayContaining(["fwzn", "xsfw"]),
		});
		expect(config.targetSourceMap.targets[2]).toMatchObject({
			consumerFamily: "academic_calendar_candidate",
			inventoryOnly: false,
			materializationPolicy: "candidate_only",
			requiredEvidence: ["calendar_arrangement"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "selected_write_requires_review",
			selectedWriteTarget: "calendar/academic_calendar",
			sourceHosts: ["www.muc.edu.cn"],
		});
		expect(config.targetSourceMap.targets[4]).toMatchObject({
			consumerFamily: "regulation_candidate",
			inventoryOnly: false,
			materializationPolicy: "release_gate_required",
			requiredEvidence: ["regulation_text"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/institutional_rules",
			sourceHosts: ["xxgk.muc.edu.cn", "met.muc.edu.cn"],
		});
		expect(config.targetSourceMap.targets[5]).toMatchObject({
			consumerFamily: "student_regulation_candidate",
			inventoryOnly: false,
			materializationPolicy: "release_gate_required",
			requiredEvidence: ["regulation_text"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/student_rules",
			sourceHosts: ["xxgk.muc.edu.cn"],
		});
		expect(config.targetSourceMap.targets[6]).toMatchObject({
			consumerFamily: "notice_news_candidate",
			inventoryOnly: true,
			materializationPolicy: "inventory_only",
			retentionPolicy: "inventory_only",
			reviewPolicy: "inventory_only",
			selectedWriteTarget: "",
		});
		expect(config.targetInventory.inventoryVersion).toBe("muc_public_target_inventory_v13");
		expect(config.targetInventory.entries.map((entry) => entry.inventoryId)).toEqual([
			"muc-main-homepage-contact",
			"muc-information-disclosure-contact",
			"muc-information-disclosure-application-process",
			"muc-it-student-campus-card-service-guide",
			"muc-it-network-auth-service-guide",
			"muc-it-vpn-service-guide",
			"muc-it-email-service-guide",
			"muc-it-password-reset-service-guide",
			"muc-it-network-account-management-guide",
			"muc-it-staff-campus-card-service-guide",
			"muc-it-enterprise-wechat-guide",
			"muc-it-enterprise-wechat-faq-guide",
			"muc-it-enterprise-wechat-phone-update-guide",
			"muc-it-directory-lookup-guide",
			"muc-it-academic-calendar-guide",
			"muc-public-academic-calendar",
			"muc-it-service-contacts",
			"muc-logistics-service-contacts",
			"muc-information-disclosure-regulation-reference",
			"muc-it-email-policy-reference",
			"muc-it-information-system-management-policy-reference",
			"muc-it-network-security-policy-reference",
			"muc-it-campus-network-account-policy-reference",
			"muc-it-campus-card-policy-reference",
			"muc-it-information-portal-policy-reference",
			"muc-it-office-automation-policy-reference",
			"muc-it-secondary-website-policy-reference",
			"muc-it-campus-network-access-policy-reference",
			"muc-academic-committee-charter",
			"muc-staff-congress-procedure",
			"muc-student-status-management-rule",
			"muc-student-financial-aid-rule",
			"muc-student-degree-rule",
			"muc-student-reward-discipline-rule",
			"muc-school-introduction-reference",
			"muc-administrative-offices-reference",
			"muc-teaching-research-units-reference",
			"muc-library-reference",
			"muc-museum-reference",
			"muc-fee-disclosure-reference",
		]);
		expect(config.targetInventory.entries[0]).toMatchObject({
			admissionTargetId: "campus-services-contact-directory",
			consumerFamily: "contact_directory_candidate",
			optionalEvidence: ["email", "location", "office_hours"],
			optionalFields: ["email", "location", "office_hours"],
			previewStatus: "candidate",
			requiredEvidence: ["phone"],
			releaseBlockers: expect.arrayContaining(["no_preview_evidence"]),
			sourceUrls: ["https://www.muc.edu.cn/"],
		});
		expect(config.sourcePackManifest.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(config.sourcePackManifest.entries.length).toBeGreaterThan(0);
		expect(config.sourcePackManifest.entries[0]?.capturePolicy).toBe("one_time");
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-student-campus-card-service-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			optionalEvidence: ["service_entry", "service_material", "phone", "location", "office_hours"],
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1027/1127.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-information-disclosure-regulation-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceHosts: ["xxgk.muc.edu.cn"],
			sourceUrls: ["https://xxgk.muc.edu.cn/info/1005/1107.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-student-status-management-rule",
			),
		).toMatchObject({
			admissionTargetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceHosts: ["xxgk.muc.edu.cn"],
			sourceUrls: ["https://xxgk.muc.edu.cn/xsgz/jwgl.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-password-reset-service-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/1830.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-network-account-management-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1026/1106.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-staff-campus-card-service-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1026/1107.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-enterprise-wechat-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/1828.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-enterprise-wechat-faq-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/2499.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-enterprise-wechat-phone-update-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/2669.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-directory-lookup-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/1831.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-academic-calendar-guide",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			requiredEvidence: ["service_process"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1068/1832.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-public-academic-calendar",
			),
		).toMatchObject({
			admissionTargetId: "official-web-academic-calendar",
			consumerFamily: "academic_calendar_candidate",
			requiredEvidence: ["calendar_arrangement"],
			sourceHosts: ["www.muc.edu.cn"],
			sourceUrls: ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-email-policy-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceHosts: ["met.muc.edu.cn"],
			sourceUrls: ["https://met.muc.edu.cn/info/1024/1090.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-information-system-management-policy-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceUrls: ["https://met.muc.edu.cn/info/1024/1085.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-network-security-policy-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceUrls: ["https://met.muc.edu.cn/info/1024/1188.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-it-information-portal-policy-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceUrls: ["https://met.muc.edu.cn/info/1024/1088.htm"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "muc-logistics-service-contacts",
			),
		).toMatchObject({
			admissionTargetId: "campus-services-contact-directory",
			consumerFamily: "contact_directory_candidate",
			requiredEvidence: ["phone"],
			sourceHosts: ["www.muc.edu.cn"],
			sourceUrls: ["https://www.muc.edu.cn/ggfw/hqfw.htm"],
		});
		expect(
			config.targetInventory.entries.find((entry) => entry.inventoryId === "muc-library-reference"),
		).toMatchObject({
			admissionTargetId: "official-web-stable-reference",
			consumerFamily: "stable_reference_candidate",
			requiredEvidence: ["stable_reference"],
			sourceHosts: ["www.muc.edu.cn"],
			sourceUrls: ["https://www.muc.edu.cn/ggfw/tsg.htm"],
		});
		expect(config.hosts.hosts.find((item) => item.host === "www.muc.edu.cn")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "学校主页",
			rolloutOrder: 10,
		});
		expect(config.hosts.hosts.find((item) => item.host === "law.muc.edu.cn")).toMatchObject({
			hostGroup: "college",
			ownerLabel: "法学院",
			rolloutOrder: 140,
		});
		expect(plan.crawlRunId).toBe("muc_public-TEST");
		expect(plan.runIntent).toBe("baseline");
		expect(plan.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(plan.enabledHosts).toHaveLength(34);
		expect(plan.enabledHosts.find((item) => item.host === "www.muc.edu.cn")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "学校主页",
			rolloutOrder: 10,
		});
		expect(plan.seeds).toHaveLength(34);
		expect(plan.requiredArtifacts).toEqual([
			"crawl-run.json",
			"host-summary.json",
			"url-results.jsonl",
			"failures.jsonl",
		]);
		expect(schedulerPlan.siteId).toBe("muc_public");
		expect(schedulerPlan.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(schedulerPlan.timezone).toBe("Asia/Shanghai");
		expect(schedulerPlan.lanes).toHaveLength(5);
		expect(schedulerPlan.lanes[0]).toMatchObject({
			laneId: "consumer-candidate-hot",
			runIntent: "hot",
			schedulerRunKeyPattern: "muc_public:consumer-candidate-hot:{scheduled-at-iso}",
			siteId: "muc_public",
		});
		expect(schedulerPlan.lanes[1]).toMatchObject({
			laneId: "consumer-stable-baseline",
			runIntent: "baseline",
			schedulerRunKeyPattern: "muc_public:consumer-stable-baseline:{scheduled-at-iso}",
			siteId: "muc_public",
		});
		expect(
			schedulerPlan.lanes
				.filter((lane) => lane.enabled && lane.runIntent !== "repair")
				.every((lane) => lane.hostFilter.length > 0),
		).toBe(true);
	});

	it("allows multiple scheduler lanes for the same run intent when lane ids are unique", () => {
		const schedulerPlan = buildOfficialWebSchedulerPlan("muc_public", {
			now: new Date("2026-03-28T16:00:00.000Z"),
		});

		const baselineLanes = schedulerPlan.lanes.filter((lane) => lane.runIntent === "baseline");

		expect(baselineLanes.map((lane) => lane.laneId)).toEqual([
			"consumer-stable-baseline",
			"college-single-host-baseline",
			"topic-single-host-baseline",
		]);
		expect(new Set(schedulerPlan.lanes.map((lane) => lane.laneId)).size).toBe(
			schedulerPlan.lanes.length,
		);
	});

	it("allows crawl plans to carry a run intent", () => {
		const plan = buildOfficialWebCrawlPlan("muc_public", {
			crawlRunId: "muc_public-HOT",
			runIntent: "hot",
			now: new Date("2026-03-30T00:00:00.000Z"),
		});

		expect(plan.crawlRunId).toBe("muc_public-HOT");
		expect(plan.runIntent).toBe("hot");
	});
}

import { expect, it } from "vitest";

import {
	buildOfficialWebCrawlPlan,
	buildOfficialWebSchedulerPlan,
	loadOfficialWebConfig,
	resolveOfficialWebConfigPaths,
} from "../../src/core/index.ts";

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
		expect(config.site.entryHost).toBe("www.example.edu");
		expect(config.site.allowedHosts).toEqual(["www.example.edu"]);
		expect(config.hosts.hosts.filter((item) => item.enabled)).toHaveLength(1);
		expect(config.seeds.seeds).toHaveLength(1);
		expect(config.projectionDeclarations.declarations.length).toBeGreaterThan(0);
		expect(
			config.projectionDeclarations.declarations.find(
				(item) => item.pageFamily === "dynamic_shell_page",
			),
		).toMatchObject({
			action: "manual_review",
		});
		expect(config.qcPolicy.qcPolicyVersion).toBe("muc_public_synthetic_qc_v1");
		expect(config.qcPolicy.allowedReviewIssueCodes).toContain(
			"shell_family_requires_manual_review",
		);
		expect(config.qcPolicy.allowedReviewPageFamilies).toContain("dynamic_shell_page");
		expect(config.schedulerPolicy.schedulerPolicyVersion).toBe("muc_public_synthetic_scheduler_v1");
		expect(config.targetSourceMap.mapVersion).toBe("muc_public_synthetic_target_source_map_v2");
		expect(config.targetSourceMap.targets.map((target) => target.targetId)).toEqual([
			"official-web-academic-calendar",
			"official-web-stable-reference",
			"official-web-institutional-rules",
			"official-web-student-rules",
			"official-web-notice-news-inventory",
		]);
		expect(config.targetSourceMap.targets[0]).toMatchObject({
			consumerFamily: "academic_calendar_candidate",
			inventoryOnly: false,
			materializationPolicy: "candidate_only",
			requiredEvidence: ["calendar_arrangement"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "selected_write_requires_review",
			selectedWriteTarget: "calendar/academic_calendar",
			sourceHosts: ["www.example.edu"],
		});
		expect(config.targetSourceMap.targets[2]).toMatchObject({
			consumerFamily: "regulation_candidate",
			inventoryOnly: false,
			materializationPolicy: "release_gate_required",
			requiredEvidence: ["regulation_text"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/institutional_rules",
			sourceHosts: ["www.example.edu"],
		});
		expect(config.targetSourceMap.targets[3]).toMatchObject({
			consumerFamily: "student_regulation_candidate",
			inventoryOnly: false,
			materializationPolicy: "release_gate_required",
			requiredEvidence: ["regulation_text"],
			retentionPolicy: "retain_source_truth",
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/student_rules",
			sourceHosts: ["www.example.edu"],
		});
		expect(config.targetSourceMap.targets[4]).toMatchObject({
			consumerFamily: "notice_news_candidate",
			inventoryOnly: true,
			materializationPolicy: "inventory_only",
			retentionPolicy: "inventory_only",
			reviewPolicy: "inventory_only",
			selectedWriteTarget: "",
		});
		expect(config.targetInventory.inventoryVersion).toBe(
			"muc_public_synthetic_target_inventory_v1",
		);
		expect(config.targetInventory.entries.map((entry) => entry.inventoryId)).toEqual([
			"synthetic-academic-calendar",
			"synthetic-stable-reference",
			"synthetic-institutional-rule",
			"synthetic-student-rule",
		]);
		expect(config.targetInventory.entries.map((entry) => entry.consumerFamily)).not.toContain(
			"service_guide_candidate",
		);
		expect(config.targetInventory.entries.map((entry) => entry.consumerFamily)).not.toContain(
			"contact_directory_candidate",
		);
		expect(config.sourcePackManifest.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(config.sourcePackManifest.entries.map((entry) => entry.entryId)).toEqual([
			"synthetic-academic-calendar",
			"synthetic-stable-reference",
			"synthetic-institutional-rule",
			"synthetic-institutional-rules-column",
			"synthetic-student-rules-column",
		]);
		expect(config.sourcePackManifest.entries[0]?.capturePolicy).toBe("one_time");
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "synthetic-institutional-rule",
			),
		).toMatchObject({
			admissionTargetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceHosts: ["www.example.edu"],
			sourceUrls: ["https://www.example.edu/rules/policy-a"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "synthetic-student-rule",
			),
		).toMatchObject({
			admissionTargetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			requiredEvidence: ["regulation_text"],
			sourceHosts: ["www.example.edu"],
			sourceUrls: ["https://www.example.edu/students/rule-a"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "synthetic-academic-calendar",
			),
		).toMatchObject({
			admissionTargetId: "official-web-academic-calendar",
			consumerFamily: "academic_calendar_candidate",
			requiredEvidence: ["calendar_arrangement"],
			sourceHosts: ["www.example.edu"],
			sourceUrls: ["https://www.example.edu/calendar"],
		});
		expect(
			config.targetInventory.entries.find(
				(entry) => entry.inventoryId === "synthetic-stable-reference",
			),
		).toMatchObject({
			admissionTargetId: "official-web-stable-reference",
			consumerFamily: "stable_reference_candidate",
			requiredEvidence: ["stable_reference"],
			sourceHosts: ["www.example.edu"],
			sourceUrls: ["https://www.example.edu/about"],
		});
		expect(config.hosts.hosts.find((item) => item.host === "www.example.edu")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "Synthetic campus homepage",
			rolloutOrder: 10,
		});
		expect(plan.crawlRunId).toBe("muc_public-TEST");
		expect(plan.runIntent).toBe("baseline");
		expect(plan.schedulerPolicyVersion).toBe("muc_public_synthetic_scheduler_v1");
		expect(plan.enabledHosts).toHaveLength(1);
		expect(plan.enabledHosts.find((item) => item.host === "www.example.edu")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "Synthetic campus homepage",
			rolloutOrder: 10,
		});
		expect(plan.seeds).toHaveLength(1);
		expect(plan.requiredArtifacts).toEqual([
			"crawl-run.json",
			"host-summary.json",
			"url-results.jsonl",
			"failures.jsonl",
		]);
		expect(schedulerPlan.siteId).toBe("muc_public");
		expect(schedulerPlan.schedulerPolicyVersion).toBe("muc_public_synthetic_scheduler_v1");
		expect(schedulerPlan.timezone).toBe("Asia/Shanghai");
		expect(schedulerPlan.lanes).toHaveLength(3);
		expect(schedulerPlan.lanes[0]).toMatchObject({
			laneId: "synthetic-hot",
			runIntent: "hot",
			schedulerRunKeyPattern: "muc_public:synthetic-hot:{scheduled-at-iso}",
			siteId: "muc_public",
		});
		expect(schedulerPlan.lanes[1]).toMatchObject({
			laneId: "synthetic-baseline",
			runIntent: "baseline",
			schedulerRunKeyPattern: "muc_public:synthetic-baseline:{scheduled-at-iso}",
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

		expect(baselineLanes.map((lane) => lane.laneId)).toEqual(["synthetic-baseline"]);
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

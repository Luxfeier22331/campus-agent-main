import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { loadOfficialWebConfig } from "../../src/core/index.ts";
import { writeSourcePackFixtureRoot } from "./source-pack-fixtures";

export function registerOfficialWebSourcePackPart02() {
	it("fails closed when a multi-owner source-pack row cannot map to compatible release targets", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-multi-owner",
							url: "https://www.example.edu/rules/",
							content_family: "institutional_policy_reference",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-rules"],
							owner_surfaces: ["regulations/institutional_rules", "regulations/student_rules"],
							release_targets: ["regulations/institutional_rules"],
							expected_facts: ["regulation_text"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							eval_questions: ["学校规定有哪些？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/multi-owner row must map each owner surface to a compatible release target/u,
		);
	});

	it("fails closed when a source-pack row tries to admit notice/news runtime", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-news-open",
							url: "https://www.example.edu/news/123",
							content_family: "public_notice_news",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-latest-news"],
							owner_surfaces: ["future_notice_runtime"],
							release_targets: ["official_web/fresh_news"],
							expected_facts: ["notice_news"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							eval_questions: ["最近有什么新闻？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/attempts to open official_web\/fresh_news or official_web\/news_archive/u,
		);
	});

	it("fails closed when an academic-calendar source-pack row is typed as a service guide", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-calendar-family",
							url: "https://www.example.edu/calendar",
							content_family: "university_core_reference",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-academic-calendar"],
							owner_surfaces: ["calendar/academic_calendar"],
							release_targets: ["calendar/academic_calendar"],
							expected_facts: ["calendar_arrangement"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							eval_questions: ["今天第几教学周？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/academic calendar row must use academic_calendar_reference content_family/u,
		);
	});

	it("fails closed when a target-workset expansion row is marked answer-bearing", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-discovery-answer-bearing",
							url: "https://www.example.edu/rules/",
							content_family: "institutional_policy_reference",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-rules-column"],
							owner_surfaces: ["regulations/institutional_rules"],
							release_targets: ["regulations/institutional_rules"],
							expected_facts: ["regulation_text"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							target_workset_expansion: "same_host_manual_requeue",
							eval_questions: ["学校规章有哪些？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/target-workset expansion row must not be answer-bearing/u,
		);
	});
}

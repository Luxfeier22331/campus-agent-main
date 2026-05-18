import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { loadOfficialWebConfig } from "../src/index";
import { writeSourcePackFixtureRoot } from "./source-pack-fixtures";

export function registerOfficialWebSourcePackPart01() {
	it("loads a source-pack manifest from the canonical site path", () => {
		const configRoot = writeSourcePackFixtureRoot();

		const config = loadOfficialWebConfig("campus_public", { configRoot });

		expect(config.sourcePackManifest).toMatchObject({
			schemaVersion: "official_web_source_pack_manifest.v1",
			siteId: "campus_public",
			sourcePackId: "tool-driven-first-slice.v1",
		});
		expect(config.sourcePackManifest.entries).toHaveLength(5);
		expect(config.sourcePackManifest.entries[1]).toMatchObject({
			entryId: "campus-card-contact",
			ownerSurfaces: ["service_guide_lookup", "contact_directory_lookup"],
			releaseTargets: ["campus_services/service_guide", "campus_services/contact_directory"],
		});
		expect(config.sourcePackManifest.entries[3]).toMatchObject({
			entryId: "institutional-rules-column",
			answerBearing: false,
			targetWorksetExpansion: "same_host_manual_requeue",
		});
		expect(config.sourcePackManifest.entries[4]).toMatchObject({
			entryId: "student-rules-column",
			answerBearing: false,
			targetWorksetExpansion: "same_host_manual_requeue",
		});
	});

	it("loads an alternate source-pack manifest when sourcePackId is provided", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"official-web-regulation-expansion.v1.json",
		);
		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "official-web-regulation-expansion.v1",
					entries: [
						{
							entry_id: "student-rules-column",
							url: "https://www.example.edu/xsgz/jwgl",
							content_family: "institutional_policy_reference",
							source_kind: "html_page",
							answer_bearing: false,
							demand_ids: ["owsp-student-rules-column"],
							owner_surfaces: ["regulations/student_rules"],
							release_targets: ["regulations/student_rules"],
							expected_facts: ["regulation_text"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							target_workset_expansion: "same_host_manual_requeue",
							eval_questions: [],
						},
					],
				},
				null,
				2,
			),
		);

		const config = loadOfficialWebConfig("campus_public", {
			configRoot,
			sourcePackId: "official-web-regulation-expansion.v1",
		});

		expect(config.paths.sourcePackId).toBe("official-web-regulation-expansion.v1");
		expect(config.sourcePackManifest.sourcePackId).toBe("official-web-regulation-expansion.v1");
		expect(config.sourcePackManifest.entries).toHaveLength(1);
		expect(config.sourcePackManifest.entries[0]).toMatchObject({
			entryId: "student-rules-column",
			ownerSurfaces: ["regulations/student_rules"],
			releaseTargets: ["regulations/student_rules"],
		});
	});
}

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	buildRegulationConsumptionByDocumentId,
	loadRegulationConsumptionManifest,
	resolveRegulationGroupMeta,
} from "../scripts/regulation-consumption";

describe("public regulation consumption manifest", () => {
	it("covers the agreed 23 public regulation docs with stable group counts", () => {
		const manifest = loadRegulationConsumptionManifest();
		const byDocumentId = buildRegulationConsumptionByDocumentId();
		const counts = manifest.documents.reduce<Record<string, number>>((accumulator, entry) => {
			accumulator[entry.docs_nav_group] = (accumulator[entry.docs_nav_group] ?? 0) + 1;
			return accumulator;
		}, {});

		expect(manifest.documents).toHaveLength(23);
		expect(new Set(manifest.documents.map((entry) => entry.document_id)).size).toBe(23);
		expect(byDocumentId.size).toBe(23);
		expect(counts).toEqual({
			public_service: 10,
			staff_governance: 7,
			student: 6,
		});
		expect(
			manifest.documents.filter(
				(entry) => entry.canonical_scope === "regulations/institutional_rules",
			),
		).toHaveLength(17);
		expect(
			manifest.documents.filter((entry) => entry.canonical_scope === "regulations/student_rules"),
		).toHaveLength(6);
		expect(
			manifest.documents.filter(
				(entry) =>
					entry.canonical_scope === "regulations/institutional_rules" &&
					entry.rag_default_exposure === "gated",
			),
		).toHaveLength(7);
		expect(
			manifest.documents.find(
				(entry) =>
					entry.title === "中央民族大学信息公开实施细则" &&
					entry.docs_nav_group === "public_service" &&
					entry.source_url === "https://xxgk.muc.edu.cn/info/1005/1107.htm",
			),
		).toBeDefined();
	});

	it("exposes stable nav group metadata for downstream docs consumers", () => {
		expect(resolveRegulationGroupMeta("student")).toEqual({
			displayName: "学生规章",
			slug: "student",
		});
		expect(resolveRegulationGroupMeta("public_service")).toEqual({
			displayName: "校园服务制度",
			slug: "public-service",
		});
		expect(resolveRegulationGroupMeta("staff_governance")).toEqual({
			displayName: "教职工与校级治理",
			slug: "staff-governance",
		});
	});

	it("keeps an official-web versus handbook overlap ledger for version-aware expansion planning", () => {
		const ledgerPath =
			"/home/reptilian/code/campus-agent/configs/ingestion/regulations/public-regulation-handbook-overlap-ledger.v1.json";
		const payload = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
			documents: Array<{
				handbook_match_document_id: string | null;
				official_title: string;
				official_url: string;
				relation_type:
					| "duplicate_official_older"
					| "duplicate_official_newer"
					| "same_theme_distinct_rule"
					| "net_new";
			}>;
			schema_version: string;
		};

		expect(payload.schema_version).toBe("public_regulation_handbook_overlap_ledger.v1");
		expect(payload.documents).toHaveLength(23);
		expect(
			payload.documents.find(
				(entry) =>
					entry.official_title === "中央民族大学信息公开实施细则" &&
					entry.official_url === "https://xxgk.muc.edu.cn/info/1005/1107.htm" &&
					entry.relation_type === "net_new" &&
					entry.handbook_match_document_id === null,
			),
		).toBeDefined();
		expect(
			payload.documents.find(
				(entry) =>
					entry.official_title === "本科生转专业实施细则" &&
					entry.relation_type === "same_theme_distinct_rule" &&
					entry.handbook_match_document_id ===
						"handbook:d5f01ceb2da8c830f904dbc049c8aca41fedf485",
			),
		).toBeDefined();
	});
});

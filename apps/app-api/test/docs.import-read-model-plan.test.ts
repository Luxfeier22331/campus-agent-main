// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	importDocsReadModelPlan,
	resolveDocsReadModelManifestPath,
} from "../ops/docs-reader/import-docs-read-model";
import type { DocsReadModelImportPlan } from "../src/modules/docs/read-model-manifest";

class FakeQueryable {
	public readonly calls: Array<{ sql: string; values?: unknown[] }> = [];

	public failOnCall = 0;

	async query(sql: string, values?: unknown[]): Promise<unknown> {
		this.calls.push({ sql, values });
		if (this.failOnCall > 0 && this.calls.length === this.failOnCall) {
			throw new Error("database write failed");
		}
		return {};
	}
}

describe("docs read model import plan", () => {
	it("replaces only manifest scopes and writes docs read model rows transactionally", async () => {
		const client = new FakeQueryable();

		await importDocsReadModelPlan(client, createPlan());

		expect(client.calls[0]?.sql).toBe("begin");
		expect(client.calls[1]).toEqual({
			sql: "delete from docs.documents where corpus = $1 and collection = $2",
			values: ["curriculum", "curriculum_plan"],
		});
		expect(client.calls[2]).toEqual({
			sql: "delete from docs.collections where corpus = $1 and collection = $2",
			values: ["curriculum", "curriculum_plan"],
		});
		expect(client.calls.at(-1)?.sql).toBe("commit");
		expect(client.calls.some((call) => call.sql.includes("insert into docs.collections"))).toBe(
			true,
		);
		expect(client.calls.some((call) => call.sql.includes("insert into docs.documents"))).toBe(true);
		expect(
			client.calls.some((call) => call.sql.includes("insert into docs.document_versions")),
		).toBe(true);
		expect(client.calls.some((call) => call.sql.includes("insert into docs.reader_assets"))).toBe(
			true,
		);
		expect(client.calls.some((call) => call.sql.includes("insert into docs.search_units"))).toBe(
			true,
		);
	});

	it("rolls back when a read model write fails", async () => {
		const client = new FakeQueryable();
		client.failOnCall = 4;

		await expect(importDocsReadModelPlan(client, createPlan())).rejects.toThrow(
			"database write failed",
		);

		expect(client.calls.at(-1)?.sql).toBe("rollback");
	});

	it("ignores pnpm argument separator when resolving manifest path", () => {
		expect(resolveDocsReadModelManifestPath(["--", "../../var/docs.json"], {})).toBe(
			"../../var/docs.json",
		);
	});

	it("fails closed on multiple manifest path arguments", () => {
		expect(() => resolveDocsReadModelManifestPath(["a.json", "b.json"], {})).toThrow(
			"expected exactly one docs read-model manifest path",
		);
	});
});

function createPlan(): DocsReadModelImportPlan {
	return {
		collections: [
			{
				collection: "curriculum_plan",
				corpus: "curriculum",
				description: "当前公开的培养方案。",
				displayName: "培养方案",
				updatedAt: "2026-04-27T08:00:00.000Z",
			},
		],
		documentVersions: [
			{
				deliveryMode: "public_static_asset",
				docId: "curriculum:law",
				effectiveFrom: "2026-02-01",
				entitlementGroups: [],
				isCurrent: true,
				label: "现行版",
				updatedAt: "2026-04-27T08:00:00.000Z",
				versionId: "ver_law",
				versionSlug: "2026-current",
				visibilityLevel: "public",
			},
		],
		documents: [
			{
				canonicalUrl: "/docs/curriculum/curriculum_plan/law",
				collection: "curriculum_plan",
				corpus: "curriculum",
				currentVersionId: "ver_law",
				currentVersionSlug: "2026-current",
				docId: "curriculum:law",
				documentSlug: "law",
				title: "法学本科人才培养方案",
				updatedAt: "2026-04-27T08:00:00.000Z",
			},
		],
		generatedAt: "2026-04-27T08:00:00.000Z",
		readerAssets: [
			{
				contentUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
				manifestUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/asset-manifest.json",
				outlineUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/outline.json",
				sourceObjects: {
					reader: "curriculum/documents/curriculum_plan/law/current/reader-assets/reader.json",
				},
				staticPrefix: "/_docs/curriculum/curriculum_plan/law/2026-current",
				targetObjects: {
					reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
				},
				updatedAt: "2026-04-27T08:00:00.000Z",
				versionId: "ver_law",
			},
		],
		schemaVersion: "document_reader_publish_manifest_v1",
		scopes: [{ collection: "curriculum_plan", corpus: "curriculum" }],
		searchUnits: [
			{
				anchor: "section-1",
				canonicalUrl: "/docs/curriculum/curriculum_plan/law#section-1",
				docId: "curriculum:law",
				highlightRootUnitIds: ["root-1"],
				searchText: "第一学期开设法理学。",
				searchUnitId: "docs_search_unit:law-section-1",
				snippet: "第一学期开设法理学。",
				title: "第一节",
				unitOrder: 1,
				versionId: "ver_law",
			},
		],
	};
}

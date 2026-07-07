import { describe, expect, it } from "vitest";
import { resolveDocumentVersionQuery, type VersionRegistryRecord } from "../src/index.ts";

describe("document version resolution", () => {
	it("resolves the current version from the selected revision track", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			records: [
				record({
					effective_date: "2026-01-01",
					ingestion_timestamp: "2026-01-01T00:00:00+00:00",
					version_id: "v1:test-001",
				}),
				record({
					effective_date: "2026-02-01",
					ingestion_timestamp: "2026-02-01T00:00:00+00:00",
					is_current: true,
					supersedes_version_id: "v1:test-001",
					version_id: "v2:test-001",
				}),
			],
			versionQuery: { mode: "current" },
		});

		expect(resolution).toMatchObject({
			status: "resolved",
			primary_selection: {
				anchor: "current",
				version_id: "v2:test-001",
			},
			selected_version_ids: ["v2:test-001"],
		});
	});

	it("resolves historical default to the current record predecessor", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			records: [
				record({
					effective_date: "2026-01-01",
					ingestion_timestamp: "2026-01-01T00:00:00+00:00",
					version_id: "v1:test-001",
				}),
				record({
					effective_date: "2026-02-01",
					ingestion_timestamp: "2026-02-01T00:00:00+00:00",
					version_id: "v2:test-001",
				}),
				record({
					effective_date: "2026-03-01",
					ingestion_timestamp: "2026-03-01T00:00:00+00:00",
					is_current: true,
					supersedes_version_id: "v2:test-001",
					version_id: "v3:test-001",
				}),
			],
			versionQuery: { mode: "historical" },
		});

		expect(resolution.status).toBe("resolved");
		expect(resolution.primary_selection?.version_id).toBe("v2:test-001");
		expect(resolution.primary_selection?.anchor).toBe("previous");
	});

	it("resolves exact historical and exact comparison pairs", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			records: [
				record({
					effective_date: "2026-01-01",
					ingestion_timestamp: "2026-01-01T00:00:00+00:00",
					version_id: "v1:test-001",
				}),
				record({
					effective_date: "2026-02-01",
					ingestion_timestamp: "2026-02-01T00:00:00+00:00",
					version_id: "v2:test-001",
				}),
				record({
					effective_date: "2026-03-01",
					ingestion_timestamp: "2026-03-01T00:00:00+00:00",
					is_current: true,
					supersedes_version_id: "v2:test-001",
					version_id: "v3:test-001",
				}),
			],
			versionQuery: {
				compare_to_version_id: "v2:test-001",
				mode: "compare",
				version_id: "v1:test-001",
			},
		});

		expect(resolution).toMatchObject({
			status: "resolved",
			primary_selection: {
				anchor: "exact",
				version_id: "v1:test-001",
			},
			comparison_selection: {
				anchor: "exact",
				version_id: "v2:test-001",
			},
			selected_version_ids: ["v1:test-001", "v2:test-001"],
		});
	});

	it("resolves as-of using effective date before published date and ingestion time", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			records: [
				record({
					effective_date: "2026-01-10",
					ingestion_timestamp: "2026-01-05T00:00:00+00:00",
					version_id: "v1:test-001",
				}),
				record({
					effective_date: "2026-02-10",
					ingestion_timestamp: "2026-02-05T00:00:00+00:00",
					is_current: true,
					supersedes_version_id: "v1:test-001",
					version_id: "v2:test-001",
				}),
			],
			versionQuery: { as_of: "2026-01-15", mode: "as_of" },
		});

		expect(resolution.status).toBe("resolved");
		expect(resolution.primary_selection?.version_id).toBe("v1:test-001");
		expect(resolution.primary_selection?.anchor).toBe("as_of");
	});

	it("prefers explicitly requested revision tracks", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			preferredRevisionTracks: ["editorial", "source-faithful"],
			records: [
				record({
					ingestion_timestamp: "2026-01-01T00:00:00+00:00",
					version_id: "v1:source",
				}),
				record({
					ingestion_timestamp: "2026-02-01T00:00:00+00:00",
					is_current: true,
					supersedes_version_id: "v1:source",
					version_id: "v2:source",
				}),
				record({
					ingestion_timestamp: "2026-01-02T00:00:00+00:00",
					revision_track: "editorial",
					version_id: "v1:editorial",
				}),
				record({
					ingestion_timestamp: "2026-02-02T00:00:00+00:00",
					is_current: true,
					revision_track: "editorial",
					supersedes_version_id: "v1:editorial",
					version_id: "v2:editorial",
				}),
			],
			versionQuery: { mode: "historical" },
		});

		expect(resolution.status).toBe("resolved");
		expect(resolution.primary_selection?.revision_track).toBe("editorial");
		expect(resolution.primary_selection?.version_id).toBe("v1:editorial");
	});

	it("fails closed when a compare pair cannot resolve distinct versions", () => {
		const resolution = resolveDocumentVersionQuery({
			documentId: "handbook:test-001",
			records: [
				record({
					effective_date: "2026-03-01",
					ingestion_timestamp: "2026-03-01T00:00:00+00:00",
					is_current: true,
					version_id: "v1:test-001",
				}),
			],
			versionQuery: { mode: "compare" },
		});

		expect(resolution).toMatchObject({
			status: "unresolved",
			unresolved_reason: "compare_pair_unresolved",
			selected_version_ids: [],
		});
	});
});

function record(input: Partial<VersionRegistryRecord> & Pick<VersionRegistryRecord, "version_id">) {
	return {
		collection: "student_rules",
		corpus: "regulations",
		document_id: "handbook:test-001",
		ingestion_timestamp: "2026-01-01T00:00:00+00:00",
		is_current: false,
		revision_track: "source-faithful",
		...input,
	} satisfies VersionRegistryRecord;
}

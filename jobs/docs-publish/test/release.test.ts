import { describe, expect, it } from "vitest";

import { publishDocsRelease, loadDocsRelease } from "../src/publisher.ts";
import { materializeProjection } from "../src/materialize.ts";
import { buildReleaseManifest } from "../src/release.ts";
import { canonicalJsonBytes, normalizeProjection, releaseManifestKey, sha256 } from "../src/release.ts";
import type { DocsAppProjection, DocsObjectStore, ObjectRef } from "../src/types.ts";

describe("docs release publication", () => {
	it("produces the same content-addressed release for equivalent input", async () => {
		const store = memoryStore();
		const input = projection();
		const bytes = canonicalJsonBytes(input);
		const inputRef = await store.createOrVerify({
			body: bytes,
			contentType: "application/json",
			key: "inputs/docs.json",
		});

		const first = await publishDocsRelease({ inputRef, store });
		const second = await publishDocsRelease({ inputRef, store });

		expect(second).toEqual(first);
		expect(await store.readByKey(releaseManifestKey(first.releaseId))).toBeTruthy();
		const loaded = await loadDocsRelease({ releaseId: first.releaseId, store });
		expect(loaded.manifest.surface).toBe("campus_docs");
		expect(loaded.manifest.entries[0]?.documentSlug).toBe("student-rules");
		expect(loaded.manifest).not.toHaveProperty("generatedAt");
	});

	it("changes release identity when projection content changes", async () => {
		const store = memoryStore();
		const firstInput = projection();
		const secondInput = projection();
		secondInput.documents[0]!.title = "新版学生手册";
		const firstRef = await putInput(store, "inputs/first.json", firstInput);
		const secondRef = await putInput(store, "inputs/second.json", secondInput);

		const first = await publishDocsRelease({ inputRef: firstRef, store });
		const second = await publishDocsRelease({ inputRef: secondRef, store });
		expect(second.releaseId).not.toBe(first.releaseId);
	});

	it("rejects broken projection relationships", () => {
		const input = projection();
		input.documents[0]!.currentVersionId = "missing";
		expect(() => normalizeProjection(input)).toThrow("current version is missing");
	});

	it("rejects incomplete reader packages and unsupported publication policy", () => {
		const incomplete = projection();
		delete incomplete.readerAssets[0]?.sourceObjects.meta;
		expect(() => normalizeProjection(incomplete)).toThrow("reader asset requires");

		const unsupported = projection();
		unsupported.documentVersions[0]!.visibilityLevel = "restricted";
		expect(() => normalizeProjection(unsupported)).toThrow("unsupported publication policy");
	});

	it("replaces one release projection atomically and remains rerunnable", async () => {
		const calls: Array<{ params?: unknown[]; sql: string }> = [];
		const client = {
			async query(sql: string, params?: unknown[]) {
				calls.push({ params, sql });
				return { rows: [] };
			},
		};
		const value = projection();
		const projectionRef: ObjectRef = {
			byteSize: 1,
			key: "projection.json",
			sha256: `sha256:${"b".repeat(64)}`,
		};
		const manifest = buildReleaseManifest(value, projectionRef, [projectionRef]);
		const releaseId = `sha256:${"a".repeat(64)}`;

		await materializeProjection(client, releaseId, manifest, value);
		await materializeProjection(client, releaseId, manifest, value);

		expect(calls.filter((call) => call.sql === "begin")).toHaveLength(2);
		expect(calls.filter((call) => call.sql === "commit")).toHaveLength(2);
		expect(
			calls.filter((call) => call.sql === "delete from docs.releases where release_id = $1"),
		).toHaveLength(2);
		expect(calls.some((call) => call.sql.includes("on conflict"))).toBe(false);
	});
});

async function putInput(
	store: DocsObjectStore,
	key: string,
	value: DocsAppProjection,
): Promise<ObjectRef> {
	return store.createOrVerify({ body: canonicalJsonBytes(value), contentType: "application/json", key });
}

function memoryStore(): DocsObjectStore {
	const objects = new Map<string, Uint8Array>();
	return {
		async createOrVerify(input) {
			const existing = objects.get(input.key);
			if (existing && sha256(existing) !== sha256(input.body)) {
				throw new Error(`object conflict: ${input.key}`);
			}
			objects.set(input.key, input.body);
			return { byteSize: input.body.byteLength, key: input.key, sha256: sha256(input.body) };
		},
		async read(ref) {
			const bytes = objects.get(ref.key);
			if (!bytes) throw new Error(`missing object: ${ref.key}`);
			if (bytes.byteLength !== ref.byteSize || sha256(bytes) !== ref.sha256) {
				throw new Error(`object mismatch: ${ref.key}`);
			}
			return bytes;
		},
		async readByKey(key) {
			return objects.get(key);
		},
	};
}

function projection(): DocsAppProjection {
	return {
		collections: [
			{
				collection: "student_rules",
				corpus: "regulations",
				displayName: "学生规定",
				updatedAt: "2026-07-16T00:00:00.000Z",
			},
		],
		documents: [
			{
				canonicalUrl: "/docs/regulations/student_rules/student-rules",
				collection: "student_rules",
				corpus: "regulations",
				currentVersionId: "version-1",
				currentVersionSlug: "current",
				docId: "doc-1",
				documentSlug: "student-rules",
				title: "学生手册",
				updatedAt: "2026-07-16T00:00:00.000Z",
			},
		],
		documentVersions: [
			{
				deliveryMode: "public_static_asset",
				docId: "doc-1",
				entitlementGroups: [],
				isCurrent: true,
				label: "现行版",
				updatedAt: "2026-07-16T00:00:00.000Z",
				versionId: "version-1",
				versionSlug: "current",
				visibilityLevel: "public",
			},
		],
		readerAssets: [
			{
				contentUrl: "/_docs/regulations/student_rules/student-rules/current/reader.json",
				outlineUrl: "/_docs/regulations/student_rules/student-rules/current/outline.json",
				sourceObjects: {
					"asset-manifest": "reader-assets/student-rules/asset-manifest.json",
					meta: "reader-assets/student-rules/meta.json",
					outline: "reader-assets/student-rules/outline.json",
					reader: "reader-assets/student-rules/reader.json",
				},
				staticPrefix: "_docs/regulations/student_rules/student-rules/current",
				targetObjects: {
					"asset-manifest": "_docs/regulations/student_rules/student-rules/current/asset-manifest.json",
					meta: "_docs/regulations/student_rules/student-rules/current/meta.json",
					outline: "_docs/regulations/student_rules/student-rules/current/outline.json",
					reader: "_docs/regulations/student_rules/student-rules/current/reader.json",
				},
				updatedAt: "2026-07-16T00:00:00.000Z",
				versionId: "version-1",
			},
		],
		schemaVersion: "campus_docs_app_projection.v1",
		searchUnits: [
			{
				anchor: "scope",
				canonicalUrl: "/docs/regulations/student_rules/student-rules#scope",
				docId: "doc-1",
				highlightRootUnitIds: ["unit-1"],
				searchText: "适用范围",
				searchUnitId: "search-1",
				snippet: "适用于全体学生。",
				title: "适用范围",
				unitOrder: 0,
				versionId: "version-1",
			},
		],
	};
}

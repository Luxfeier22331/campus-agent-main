import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs/fixture";
import { buildReaderRouteSlug, DOCS_SOURCE_KEY } from "campus-contracts/campus-docs/node";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { checkDocsSource, parseDocsSourceRootArgs } from "../scripts/check-docs-source.ts";
import { publishDocsSourceFromDeclarations } from "../scripts/publish-docs-source.ts";
import { canonicalJsonBytes } from "../src/docs-reader-build/artifact-digest.ts";
import {
	compileDocsSourceDeclarations,
	readDocsSourceDeclarations,
	writeDocsSourceDeclarations,
} from "../src/docs-reader-build/source-declarations.ts";
import {
	docsSourceReleaseKey,
	publishDocsSource,
} from "../src/docs-reader-build/source-publisher.ts";
import { createMemoryDocsSourceStore } from "./helpers/docs-source-store.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function fixture() {
	const input = createDocsSourceSiteFixture();
	const root = mkdtempSync(join(tmpdir(), "docs-declarations-"));
	roots.push(root);
	writeDocsSourceDeclarations({ outputRoot: root, source: input.source });
	const store = createMemoryDocsSourceStore(
		new Map([...input.objects].map(([key, value]) => [key, value.body])),
	);
	const document = input.source.documents[0];
	assert(document);
	const version = input.source.versions.find((item) => item.docId === document.docId);
	assert(version);
	const documentRoot = join(
		root,
		"documents",
		document.corpus,
		document.collection,
		buildReaderRouteSlug(document),
	);
	return {
		...input,
		root,
		store,
		document,
		version,
		documentRoot,
		documentPath: join(documentRoot, "document.yaml"),
		versionPath: join(documentRoot, "versions", `${version.versionSlug}.yaml`),
	};
}

function editYaml(path: string, update: (value: Record<string, unknown>) => void) {
	const value = parse(readFileSync(path, "utf8"));
	update(value);
	writeFileSync(path, stringify(value));
}

function editYamlArray(path: string, update: (value: unknown[]) => void) {
	const value: unknown[] = parse(readFileSync(path, "utf8"));
	update(value);
	writeFileSync(path, stringify(value));
}

describe("Docs Git declarations", () => {
	it("validates the real catalog without any object storage connection", () => {
		expect(checkDocsSource().documentCount).toBeGreaterThan(0);
	});

	it("round-trips all versions, course maps and redirects without persisting object hashes or sizes", async () => {
		const f = fixture();
		const compiled = await compileDocsSourceDeclarations({ root: f.root, client: f.store });
		expect(compiled.sourceBytes).toEqual(f.sourceBytes);
		expect(compiled.sourceDigest).toBe(f.sourceDigest);
		for (const file of readdirSync(f.root, { recursive: true })
			.map(String)
			.filter((name) => name.endsWith(".yaml"))) {
			expect(readFileSync(join(f.root, file), "utf8")).not.toMatch(/^\s*(sha256|byteSize):/mu);
		}
		editYamlArray(join(f.root, "collections.yaml"), (value) => value.reverse());
		editYamlArray(join(f.root, "topics.yaml"), (value) => value.reverse());
		expect(
			(await compileDocsSourceDeclarations({ root: f.root, client: f.store })).sourceDigest,
		).toBe(f.sourceDigest);
	});

	it("preserves non-filesystem document and version identities", () => {
		const f = fixture();
		editYaml(f.documentPath, (value) => {
			value.docId = "文档:招生/规定";
		});
		for (const file of readdirSync(join(f.documentRoot, "versions"))) {
			editYaml(join(f.documentRoot, "versions", file), (value) => {
				value.docId = "文档:招生/规定";
				value.versionId = `sha256:${"a".repeat(64)}:中文:${value.versionSlug}`;
			});
		}
		expect(
			readDocsSourceDeclarations(f.root).documents.some((doc) => doc.docId === "文档:招生/规定"),
		).toBe(true);
	});

	it("carries optional version details into the compiled source", async () => {
		const f = fixture();
		const details = {
			documentNumber: "民大校发〔2025〕141号",
			effectiveDate: "2025-09-01",
			source: { name: "学校信息公开网", url: "https://xxgk.muc.edu.cn/info/1198/4051.htm" },
		};
		editYaml(f.versionPath, (value) => {
			value.details = details;
		});
		const compiled = await compileDocsSourceDeclarations({ root: f.root, client: f.store });
		expect(
			compiled.source.versions.find((item) => item.versionId === f.version.versionId)?.details,
		).toEqual(details);
		expect(
			compiled.compiled.manifest.entries.find((item) => item.versionId === f.version.versionId)
				?.details,
		).toEqual(details);
		expect(compiled.source.versions.filter((item) => item.details !== undefined)).toHaveLength(1);
	});

	it.each([
		[
			"unknown fields",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.documentPath, (value) => {
					value.sha256 = "manual";
				}),
			/unknown field/,
		],
		[
			"missing topic",
			(f: ReturnType<typeof fixture>) =>
				editYamlArray(join(f.root, "topics.yaml"), (value) => {
					value.splice(0);
				}),
			/topic is missing/,
		],
		[
			"duplicate document ID",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.documentPath, (value) => {
					value.docId = f.source.documents[1]?.docId;
				}),
			/different document|duplicate document/,
		],
		[
			"duplicate collection",
			(f: ReturnType<typeof fixture>) =>
				editYamlArray(join(f.root, "collections.yaml"), (value) => {
					value.push(value[0]);
				}),
			/duplicate collection/,
		],
		[
			"invalid redirect",
			(f: ReturnType<typeof fixture>) =>
				editYamlArray(join(f.root, "redirects.yaml"), (value) => {
					value.push({
						fromPath: "/docs/regulations/student_rules/old",
						toPath: "/docs/missing/collection/doc",
						statusCode: 308,
					});
				}),
			/target must be a published/,
		],
		[
			"unsafe reader key",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.versionPath, (value) => {
					value.readerKey = "../reader.json";
				}),
			/safe relative object key/,
		],
		[
			"empty version details",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.versionPath, (value) => {
					value.details = {};
				}),
			/details must not be empty/,
		],
		[
			"unknown version detail",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.versionPath, (value) => {
					value.details = { issuer: "教务处" };
				}),
			/unknown field: issuer/,
		],
		[
			"invalid effective date",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.versionPath, (value) => {
					value.details = { effectiveDate: "2025-02-30" };
				}),
			/YYYY-MM-DD date/,
		],
		[
			"non-https source link",
			(f: ReturnType<typeof fixture>) =>
				editYaml(f.versionPath, (value) => {
					value.details = { source: { name: "官网", url: "http://xxgk.muc.edu.cn/" } };
				}),
			/https URL/,
		],
		[
			"invalid version",
			(f: ReturnType<typeof fixture>) => {
				editYaml(f.versionPath, (value) => {
					value.versionSlug = "latest";
				});
				renameSync(f.versionPath, join(f.documentRoot, "versions/latest.yaml"));
			},
			/version slug must be/,
		],
	] as const)("rejects %s offline", (_name, update, error) => {
		const f = fixture();
		update(f);
		expect(() => checkDocsSource(f.root)).toThrow(error);
	});

	it("parses the offline check source-root argument", () => {
		const root = join(tmpdir(), "docs-check-root");
		expect(parseDocsSourceRootArgs(["--", "--source-root", root])).toBe(resolve(root));
		expect(() => parseDocsSourceRootArgs(["--source-root"])).toThrow("usage:");
	});
});

describe("Generated Docs publication", () => {
	it("creates the immutable copy and updates the fixed key idempotently", async () => {
		const f = fixture();
		const first = await publishDocsSourceFromDeclarations({ client: f.store, root: f.root });
		const second = await publishDocsSourceFromDeclarations({ client: f.store, root: f.root });
		expect(first).toEqual(second);
		expect(first.sourceDigest).toBe(f.sourceDigest);
		expect(f.store.objects.get(first.releaseKey)).toEqual(f.sourceBytes);
		expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(f.sourceBytes);
	});

	it("creates a previously absent source with If-None-Match", async () => {
		const f = fixture();
		f.store.objects.delete(DOCS_SOURCE_KEY);
		await publishDocsSourceFromDeclarations({ client: f.store, root: f.root });
		expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(f.sourceBytes);
	});

	it("reads each declared object once and does not read back the fixed key after writing", async () => {
		const f = fixture();
		const originalReadBytes = f.store.readOptionalBytesObject;
		const originalReadCurrent = f.store.readOptionalObject;
		const reads = new Map<string, number>();
		let currentReads = 0;
		f.store.readOptionalBytesObject = async ({ key }) => {
			reads.set(key, (reads.get(key) ?? 0) + 1);
			return originalReadBytes({ key });
		};
		f.store.readOptionalObject = async ({ key }) => {
			currentReads += 1;
			return originalReadCurrent({ key });
		};

		await publishDocsSourceFromDeclarations({ client: f.store, root: f.root });

		for (const key of f.objects.keys()) {
			if (key === DOCS_SOURCE_KEY) {
				continue;
			}
			expect(reads.get(key)).toBe(1);
		}
		expect(reads.get(DOCS_SOURCE_KEY) ?? 0).toBe(0);
		expect(currentReads).toBe(1);
	});

	it("rejects a conflicting immutable copy", async () => {
		const f = fixture();
		f.store.objects.set(docsSourceReleaseKey(f.sourceDigest), new TextEncoder().encode("conflict"));
		await expect(
			publishDocsSourceFromDeclarations({ client: f.store, root: f.root }),
		).rejects.toThrow("immutable docs source release conflicts");
		expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(f.sourceBytes);
	});

	it.each([true, false])(
		"protects another publisher during compilation (existing source: %s)",
		async (existing) => {
			const f = fixture();
			if (!existing) {
				f.store.objects.delete(DOCS_SOURCE_KEY);
			}
			const other = canonicalJsonBytes({ changedBy: "another publisher" });
			await expect(
				publishDocsSource({
					client: f.store,
					source: async () => {
						f.store.objects.set(DOCS_SOURCE_KEY, other);
						return f.source;
					},
				}),
			).rejects.toThrow("changed during publication");
			expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(other);
		},
	);

	it("keeps the fixed source on missing objects and reader identity failures", async () => {
		const f = fixture();
		const body = f.store.objects.get(f.version.reader.key);
		assert(body);
		f.store.objects.delete(f.version.reader.key);
		await expect(
			publishDocsSourceFromDeclarations({ client: f.store, root: f.root }),
		).rejects.toThrow("missing declared docs object");
		const reader = JSON.parse(new TextDecoder().decode(body));
		reader.versionId = "wrong";
		f.store.objects.set(f.version.reader.key, canonicalJsonBytes(reader));
		await expect(
			publishDocsSourceFromDeclarations({ client: f.store, root: f.root }),
		).rejects.toThrow("identity does not match");
		expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(f.sourceBytes);
	});

	it("rejects reader quality defects at the publication boundary", async () => {
		const f = fixture();
		const readerBytes = f.store.objects.get(f.version.reader.key);
		assert(readerBytes);
		const reader = JSON.parse(new TextDecoder().decode(readerBytes));
		reader.elements = [
			{
				anchor: "scope",
				kind: "heading",
				level: 2,
				rootUnitId: "doc:migrated-heading-0001",
				text: "适用范围",
			},
		];
		f.store.objects.set(f.version.reader.key, canonicalJsonBytes(reader));

		await expect(
			publishDocsSourceFromDeclarations({ client: f.store, root: f.root }),
		).rejects.toThrow("reader contains migrated heading artifact");
		expect(f.store.objects.get(DOCS_SOURCE_KEY)).toEqual(f.sourceBytes);
	});

	it("reuses the bytes used to derive object references during compilation", async () => {
		const f = fixture();
		const originalRead = f.store.readOptionalBytesObject;
		let reads = 0;
		f.store.readOptionalBytesObject = async ({ key }) => {
			if (key === f.version.reader.key) {
				reads += 1;
			}
			return originalRead({ key });
		};
		const result = await publishDocsSourceFromDeclarations({ client: f.store, root: f.root });
		expect(result.sourceDigest).toBe(f.sourceDigest);
		expect(reads).toBe(1);
	});
});

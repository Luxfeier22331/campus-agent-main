import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsSourceManifest, ObjectRef } from "campus-contracts/campus-docs";
import { formatDocsVersionLabel } from "campus-contracts/campus-docs";
import { COURSE_MAP_IMAGE } from "campus-contracts/campus-docs/fixture";
import {
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	selectCurrentVersion,
} from "campus-contracts/campus-docs/node";
import { afterEach, describe, expect, it } from "vitest";
import { parseUpdateDocsSourceArgs, updateDocsSource } from "../scripts/update-docs-source.ts";
import { canonicalJsonBytes, sha256 } from "../src/docs-reader-build/artifact-digest.ts";
import type {
	DocsSourceObjectStore,
	ReaderObjectStoreClient,
} from "../src/docs-reader-build/published-reader-types.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import { docsSourceReleaseKey } from "../src/docs-reader-build/source-publisher.ts";
import { createMemoryDocsSourceStore } from "./helpers/docs-source-store.ts";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

describe("Campus Web 文档来源编译", () => {
	it("为等价来源生成稳定的发布清单", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);

		const first = await compileDocsSource({ client: store, source });
		const second = await compileDocsSource({ client: store, source: structuredClone(source) });

		expect(second.manifest).toEqual(first.manifest);
		expect(first.manifest.entries[0]).toMatchObject({
			documentSlug: "student-rules",
			topicId: "campus-life",
		});
		expect(first.manifest.entries[0]?.reader.key).toBe("readers/student-rules.json");
		const reader = await readJson(first.client, first.manifest.entries[0]?.reader);
		expect(reader).toMatchObject({
			docId: "doc-1",
			schemaVersion: "campus_docs_reader.v3",
			versionId: "version-1",
		});
	});

	it("将阅读正文读取并发限制为四个版本", async () => {
		const backingStore = memoryStore();
		const source = await sourceFixture(backingStore);
		const current = source.versions[0];
		if (!current) {
			throw new Error("source fixture is incomplete");
		}

		for (let index = 1; index < 9; index += 1) {
			const versionId = `version-history-${index}`;
			source.versions.push({
				...current,
				reader: putJson(backingStore, `readers/${versionId}.json`, {
					docId: "doc-1",
					elements: [
						{
							kind: "paragraph",
							rootUnitId: `history-${index}`,
							text: `历史版本 ${index}`,
						},
					],
					schemaVersion: "campus_docs_reader.v3",
					supplements: [],
					versionId,
				}),
				versionId,
				versionSlug: String(2026 - index),
			});
		}

		const observed = observeReadConcurrency(backingStore);
		const result = await compileDocsSource({
			client: observed.client,
			source: normalizeSourceManifest(source),
		});

		expect(observed.maxActive()).toBe(4);
		expect(result.manifest.entries).toHaveLength(9);
	});

	it("为非 ASCII 文档短名生成稳定路由", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		first(source.documents, "document").documentSlug = "中文学生手册";

		const result = await compileDocsSource({
			client: store,
			source: normalizeSourceManifest(source),
		});

		expect(result.manifest.entries[0]?.routeSlug).toBe("doc-8816136b822b");
	});

	it("按数字版本 slug 选择当前版本并派生展示标签", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		const current = first(source.versions, "version");
		const historical = {
			...current,
			versionId: "version-2025",
			versionSlug: "2025",
		};
		source.versions = [historical, current];

		const normalized = normalizeSourceManifest(source);
		const selected = selectCurrentVersion(normalized.versions, "doc-1");

		expect(selected.versionId).toBe(current.versionId);
		expect(formatDocsVersionLabel("2026")).toBe("2026 年版");
		expect(formatDocsVersionLabel("1")).toBe("第 1 版");
	});

	it("按序号版本选择最大序号，且拒绝年份与序号混用", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		const current = first(source.versions, "version");
		current.versionSlug = "1";
		source.versions.push({ ...current, versionId: "version-2", versionSlug: "2" });

		const normalized = normalizeSourceManifest(source);
		expect(selectCurrentVersion(normalized.versions, "doc-1")?.versionId).toBe("version-2");

		const mixed = await sourceFixture(store);
		mixed.versions.push({
			...first(mixed.versions, "version"),
			versionId: "version-ordinal",
			versionSlug: "1",
		});
		expect(() => normalizeSourceManifest(mixed)).toThrow(
			"document versions mix year and ordinal slugs",
		);
	});

	it("拒绝断裂关系、聚合集合和目录重定向", async () => {
		const store = memoryStore();
		const broken = await sourceFixture(store);
		broken.versions = [];
		expect(() => normalizeSourceManifest(broken)).toThrow("document has no versions");

		const aggregate = await sourceFixture(store);
		const collection = first(aggregate.collections, "collection");
		collection.corpus = "curriculum";
		collection.collection = "curriculum_plan";
		const document = first(aggregate.documents, "document");
		document.corpus = "curriculum";
		document.collection = "curriculum_plan";
		document.topicId = null;
		aggregate.topics = [];
		expect(() => normalizeSourceManifest(aggregate)).toThrow(
			"unsupported docs scope: curriculum/curriculum_plan",
		);

		const redirect = await sourceFixture(store);
		redirect.redirects = [
			{
				fromPath: "/docs/regulations/student_rules",
				statusCode: 308,
				toPath: "/docs/regulations/student_rules/student-rules",
			},
		];
		expect(() => normalizeSourceManifest(redirect)).toThrow(
			"docs redirect source must be a document URL",
		);
	});

	it("保留指向现有正文的旧正文重定向", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		source.redirects = [
			{
				fromPath: "/docs/regulations/student_rules/retired-student-rules",
				statusCode: 308,
				toPath: "/docs/regulations/student_rules/student-rules",
			},
		];

		expect(normalizeSourceManifest(source).redirects).toEqual(source.redirects);

		source.redirects = [
			{
				fromPath: "/docs/regulations/student_rules/student-rules/v/2025",
				statusCode: 308,
				toPath: "/docs/regulations/student_rules/student-rules/v/2026",
			},
		];
		expect(normalizeSourceManifest(source).redirects).toEqual(source.redirects);

		source.redirects = [
			{
				fromPath: "/docs/regulations/student_rules/student-rules/v/2026",
				statusCode: 308,
				toPath: "/docs/regulations/student_rules/student-rules",
			},
		];
		expect(() => normalizeSourceManifest(source)).toThrow("source is already published");
	});

	it("接受三个公开培养方案集合", async () => {
		for (const collection of ["undergraduate", "second_degree", "general_education"]) {
			const store = memoryStore();
			const source = await sourceFixture(store);
			const collectionEntry = first(source.collections, "collection");
			collectionEntry.corpus = "curriculum";
			collectionEntry.collection = collection;
			const document = first(source.documents, "document");
			document.corpus = "curriculum";
			document.collection = collection;
			document.topicId = null;
			source.topics = [];
			expect(() => normalizeSourceManifest(source)).not.toThrow();
		}
	});

	it("在编译时核对每个来源对象", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		first(source.versions, "version").reader = {
			byteSize: 3,
			key: "missing/reader.json",
			sha256: `sha256:${"a".repeat(64)}`,
		};

		await expect(
			compileDocsSource({ client: store, source: normalizeSourceManifest(source) }),
		).rejects.toThrow("missing published reader object: missing/reader.json");
	});

	it("在编译阶段拒绝重复的正文锚点和内容单元标识", async () => {
		const duplicateAnchorStore = memoryStore();
		const duplicateAnchorSource = await sourceFixture(duplicateAnchorStore);
		mutateFixtureReader(duplicateAnchorStore, duplicateAnchorSource, (reader) => {
			reader.elements.push({
				anchor: "scope",
				kind: "heading",
				level: 2,
				rootUnitId: "heading-2",
				text: "二、重复锚点",
			});
		});
		await expect(
			compileDocsSource({ client: duplicateAnchorStore, source: duplicateAnchorSource }),
		).rejects.toThrow("reader heading anchor is duplicated: scope");

		const duplicateRootStore = memoryStore();
		const duplicateRootSource = await sourceFixture(duplicateRootStore);
		mutateFixtureReader(duplicateRootStore, duplicateRootSource, (reader) => {
			const heading = reader.elements[1];
			if (!heading) {
				throw new Error("source fixture is missing its heading");
			}
			heading.rootUnitId = "intro-1";
		});
		await expect(
			compileDocsSource({ client: duplicateRootStore, source: duplicateRootSource }),
		).rejects.toThrow("reader rootUnitId is duplicated: intro-1");
	});

	it("在编译阶段核对正文与来源声明的补充内容", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		const rawCourseMaps = putJson(store, "inputs/course-maps.json", {
			blocks: [],
			schemaVersion: "curriculum_course_maps_reader_v1",
		});
		first(source.versions, "version").supplements = [
			{
				assets: [],
				kind: "course_maps",
				object: rawCourseMaps,
				path: "course-maps.json",
			},
		];

		await expect(compileDocsSource({ client: store, source })).rejects.toThrow(
			"reader supplements do not match docs version: version-1",
		);
	});

	it("拒绝非数字版本 slug 并保留补充资源路径校验", async () => {
		for (const delimiter of ["?", "#"]) {
			const store = memoryStore();
			const source = await sourceFixture(store);
			const version = first(source.versions, "version");
			version.versionSlug = `2026${delimiter}draft`;
			expect(() => normalizeSourceManifest(source)).toThrow(
				"version slug must be a year or positive ordinal",
			);

			const supplementStore = memoryStore();
			const supplementSource = await sourceFixture(supplementStore);
			addCourseMapSource(supplementStore, supplementSource);
			const supplement = first(
				first(supplementSource.versions, "version").supplements,
				"supplement",
			);
			first(supplement.assets, "supplement asset").path = `course-maps/course-map${delimiter}.png`;
			expect(() => normalizeSourceManifest(supplementSource)).toThrow(
				"supplement asset path for version-1 must be a safe relative path",
			);
		}

		const source = await sourceFixture(memoryStore());
		first(source.versions, "version").versionSlug = "2025-current";
		expect(() => normalizeSourceManifest(source)).toThrow(
			"version slug must be a year or positive ordinal",
		);
	});

	it("将课程图来源转换为最终公开格式", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		addCourseMapSource(store, source);

		const compiled = await compileDocsSource({
			client: store,
			source: normalizeSourceManifest(source),
		});
		const supplement = compiled.manifest.entries[0]?.supplements[0];
		expect(supplement?.object.key).toMatch(
			/^campus-web\/docs-build\/[a-f0-9]{64}\/course-maps\.json$/u,
		);
		const courseMaps = await readJson(compiled.client, supplement?.object);
		expect(courseMaps).toMatchObject({
			docId: "doc-1",
			maps: [
				{
					parts: [
						{
							height: 649,
							imagePath: "course-maps/course-map.png",
							width: 1233,
						},
					],
					targetRootUnitId: "heading-1",
				},
			],
			schemaVersion: "campus_docs_course_maps.v1",
			versionId: "version-1",
		});
	});
});

describe("Campus Web 文档来源更新", () => {
	it("校验完整来源后写入并回读固定来源键", async () => {
		const store = memoryStore();
		const source = await sourceFixture(store);
		const sourceFile = writeSourceFile(source);

		const result = await updateDocsSource({ client: store, sourceFile });

		expect(result).toEqual({
			documentCount: 1,
			releaseKey: docsSourceReleaseKey(sha256(canonicalJsonBytes(source))),
			sourceDigest: sha256(canonicalJsonBytes(source)),
			versionCount: 1,
		});
		expect(store.objects.get(DOCS_SOURCE_KEY)).toEqual(canonicalJsonBytes(source));
	});

	it("编译失败时不覆盖现有固定来源键", async () => {
		const store = memoryStore();
		const existing = new TextEncoder().encode("existing source");
		store.objects.set(DOCS_SOURCE_KEY, existing);
		const source = await sourceFixture(store);
		const rawCourseMaps = putJson(store, "inputs/invalid-course-maps.json", {
			blocks: [],
			schemaVersion: "curriculum_course_maps_reader_v1",
		});
		first(source.versions, "version").supplements = [
			{
				assets: [],
				kind: "course_maps",
				object: rawCourseMaps,
				path: "course-maps.json",
			},
		];
		setFixtureReaderSupplements(store, source);

		await expect(
			updateDocsSource({ client: store, sourceFile: writeSourceFile(source) }),
		).rejects.toThrow("must contain at least one map");
		expect(store.objects.get(DOCS_SOURCE_KEY)).toEqual(existing);
	});

	it("只接受明确的来源文件参数", () => {
		expect(parseUpdateDocsSourceArgs(["--source-file", "source.json"]).sourceFile).toBe(
			join(process.cwd(), "source.json"),
		);
		expect(() => parseUpdateDocsSourceArgs([])).toThrow("usage: update-docs-source --source-file");
	});
});

async function sourceFixture(store: MemoryStore): Promise<DocsSourceManifest> {
	const reader = putJson(store, "readers/student-rules.json", {
		docId: "doc-1",
		elements: [
			{
				kind: "paragraph",
				rootUnitId: "intro-1",
				text: "本手册说明学生在校期间适用的主要规定。",
			},
			{
				anchor: "scope",
				kind: "heading",
				level: 2,
				rootUnitId: "heading-1",
				text: "一、适用范围",
			},
			{
				kind: "table",
				rootUnitId: "table-1",
				rows: [
					[
						{ header: true, text: "适用范围" },
						{ header: true, text: "学生" },
					],
				],
			},
		],
		schemaVersion: "campus_docs_reader.v3",
		supplements: [],
		versionId: "version-1",
	});
	return normalizeSourceManifest({
		collections: [
			{
				collection: "student_rules",
				corpus: "regulations",
				description: "学生在校期间适用的规章制度。",
				displayName: "学生规定",
			},
		],
		documents: [
			{
				collection: "student_rules",
				corpus: "regulations",
				docId: "doc-1",
				documentSlug: "student-rules",
				title: "学生手册",
				topicId: "campus-life",
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_source.v4",
		topics: [
			{
				corpus: "regulations",
				description: "校园生活相关规定。",
				displayName: "校园生活",
				order: 1,
				topicId: "campus-life",
			},
		],
		versions: [
			{
				docId: "doc-1",
				reader,
				supplements: [],
				versionId: "version-1",
				versionSlug: "2026",
			},
		],
	});
}

function addCourseMapSource(store: MemoryStore, source: DocsSourceManifest): void {
	const imageRef = putBytes(store, "inputs/course-map.png", COURSE_MAP_IMAGE);
	const rawRef = putJson(store, "inputs/raw-course-maps.json", {
		blocks: [
			{
				blockId: "course-map-1",
				imagePath: "course-maps/course-map.png",
				pageNumber: 1,
				parentHeadingHint: "一、适用范围",
				regionBBoxProvider: [10, 20, 610, 320],
				title: "课程地图",
			},
		],
		docId: "doc-1",
		schemaVersion: "curriculum_course_maps_reader_v1",
		versionId: "version-1",
	});
	first(source.versions, "version").supplements = [
		{
			assets: [{ object: imageRef, path: "course-maps/course-map.png" }],
			kind: "course_maps",
			object: rawRef,
			path: "course-maps.json",
		},
	];
	setFixtureReaderSupplements(store, source);
}

interface FixtureReader {
	[key: string]: unknown;
	elements: Record<string, unknown>[];
	supplements: { kind: "course_maps"; path: "course-maps.json" }[];
}

function mutateFixtureReader(
	store: MemoryStore,
	source: DocsSourceManifest,
	mutate: (reader: FixtureReader) => void,
): void {
	const version = first(source.versions, "version");
	const bytes = store.objects.get(version.reader.key);
	if (!bytes) {
		throw new Error("source fixture reader is missing");
	}
	const reader = JSON.parse(new TextDecoder().decode(bytes)) as FixtureReader;
	mutate(reader);
	version.reader = putJson(store, version.reader.key, reader);
}

function setFixtureReaderSupplements(store: MemoryStore, source: DocsSourceManifest): void {
	mutateFixtureReader(store, source, (reader) => {
		reader.supplements = [{ kind: "course_maps", path: "course-maps.json" }];
	});
}

interface MemoryStore extends DocsSourceObjectStore {
	objects: Map<string, Uint8Array>;
}

function memoryStore(): MemoryStore {
	return createMemoryDocsSourceStore();
}

function putJson(store: MemoryStore, key: string, value: unknown): ObjectRef {
	return putBytes(store, key, canonicalJsonBytes(value));
}

function putBytes(store: MemoryStore, key: string, bytes: Uint8Array): ObjectRef {
	store.objects.set(key, bytes);
	return { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
}

async function readJson(
	client: ReaderObjectStoreClient,
	ref: ObjectRef | undefined,
): Promise<Record<string, unknown>> {
	if (!ref) {
		throw new Error("compiled fixture object is missing");
	}
	const bytes = await client.readOptionalBytesObject({ key: ref.key });
	if (!bytes) {
		throw new Error(`compiled fixture object is unavailable: ${ref.key}`);
	}
	return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function first<T>(values: readonly T[], label: string): T {
	const value = values[0];
	if (!value) {
		throw new Error(`source fixture is missing its ${label}`);
	}
	return value;
}

function observeReadConcurrency(client: ReaderObjectStoreClient): {
	client: ReaderObjectStoreClient;
	maxActive(): number;
} {
	let active = 0;
	let maximum = 0;
	return {
		client: {
			async readOptionalBytesObject(input) {
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 2));
				try {
					return await client.readOptionalBytesObject(input);
				} finally {
					active -= 1;
				}
			},
		},
		maxActive: () => maximum,
	};
}

function writeSourceFile(source: DocsSourceManifest): string {
	const root = mkdtempSync(join(tmpdir(), "campus-docs-source-update-"));
	tempRoots.push(root);
	const path = join(root, "source.json");
	writeFileSync(path, `${JSON.stringify(source, null, 2)}\n`, "utf8");
	return path;
}

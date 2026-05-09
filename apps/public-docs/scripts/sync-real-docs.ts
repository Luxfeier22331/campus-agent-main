import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildRegulationConsumptionByDocumentId,
	type RegulationNavGroup,
	resolveRegulationGroupMeta,
} from "./regulation-consumption";
import {
	buildCourseMapDocEmbedForRoute,
	syncCurriculumCourseMapArtifacts,
} from "./sync-real-docs/course-map";
import {
	buildCurriculumMarkdown,
	buildCurriculumPlanIndex,
	discoverCurriculumDocs,
	groupCurriculumDocs,
} from "./sync-real-docs/curriculum";
import { loadPublicDocsEnv } from "./sync-real-docs/env";
import {
	buildHandbookDocKey,
	cleanHandbookMarkdown,
	loadHandbookDocs,
} from "./sync-real-docs/handbook";
import { syncHandbookFlowGraphArtifacts } from "./sync-real-docs/handbook-flow-graph";
import { groupHandbookDocs } from "./sync-real-docs/ia";
import { buildHomePage } from "./sync-real-docs/pages";
import {
	buildPublicRegulationMarkdown,
	discoverPublicRegulationDocs,
} from "./sync-real-docs/regulations";
import {
	type CurriculumDoc,
	DOCS_ROOT,
	formatJsonContent,
	type HandbookDoc,
	type HandbookFlowGraphDoc,
	type PublicRegulationDoc,
	removeLegacySectionDirs,
	removeStaleGeneratedFiles,
	writeText,
} from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

type SidebarMetaEntry =
	| string
	| { type: "file"; name: string; label: string }
	| { type: "dir"; name: string; label: string; collapsed?: boolean; collapsible?: boolean }
	| { type: "section-header"; label: string };

const GROUPED_DOC_ROUTE_DEPTH_FROM_DOCS_ROOT = 3;

export async function syncRealDocs(
	input: { client?: ObjectStoreClient; docsRoot?: string } = {},
): Promise<void> {
	if (!input.client) {
		loadPublicDocsEnv();
	}
	const client = input.client ?? createS3ObjectStore();
	const docsRoot = resolve(input.docsRoot ?? DOCS_ROOT);
	const canonicalDocsRoot = resolve(docsRoot, "docs");
	const handbookDocs = loadHandbookDocs();
	const curriculumDocs = await discoverCurriculumDocs(client);
	const publicRegulationDocs = await discoverPublicRegulationDocs(client);

	removeLegacySectionDirs(docsRoot);
	for (const legacyDir of ["student-handbook", "curriculum-plan", "campus-regulations"]) {
		rmSync(resolve(docsRoot, legacyDir), { force: true, recursive: true });
	}

	writeText(
		resolve(docsRoot, "_meta.json"),
		formatJsonContent(
			buildTopLevelMetaEntries({ includePublicRegulations: publicRegulationDocs.length > 0 }),
		),
	);
	writeText(
		resolve(docsRoot, "index.md"),
		buildHomePage({ includePublicRegulations: publicRegulationDocs.length > 0 }),
	);

	await syncCanonicalDocsRoot({
		client,
		curriculumDocs,
		docsRoot,
		handbookDocs,
		canonicalDocsRoot,
		publicRegulationDocs,
	});
}

export function buildTopLevelMetaEntries(input: {
	includePublicRegulations: boolean;
}): SidebarMetaEntry[] {
	void input;
	return [
		{ type: "file", name: "index", label: "文档首页" },
		{ type: "dir", name: "docs", label: "公开文档", collapsed: false },
	];
}

export function buildHandbookMetaEntries(input: {
	flowGraphDocs: HandbookFlowGraphDoc[];
	handbookDocs: HandbookDoc[];
}): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [];
	for (const group of groupHandbookDocs(input)) {
		if (group.docs.length === 0) {
			continue;
		}
		entries.push({ type: "section-header", label: group.label });
		for (const doc of group.docs) {
			entries.push({
				type: "file",
				name: doc.slug,
				label: doc.title,
			});
		}
	}
	return entries;
}

export function buildCurriculumMetaEntries(curriculumDocs: CurriculumDoc[]): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [];
	for (const group of groupCurriculumDocs(curriculumDocs)) {
		if (group.docs.length === 0) {
			continue;
		}
		entries.push({ type: "section-header", label: group.label });
		for (const doc of group.docs) {
			entries.push({
				type: "file",
				name: doc.slug,
				label: doc.title,
			});
		}
	}
	return entries;
}

export function buildGroupMetaEntries<TDoc extends { slug: string; title: string }>(
	docs: TDoc[],
): SidebarMetaEntry[] {
	return docs.map((doc) => ({
		type: "file" as const,
		name: doc.slug,
		label: doc.title,
	}));
}

async function syncCanonicalDocsRoot(input: {
	client: ObjectStoreClient;
	curriculumDocs: CurriculumDoc[];
	docsRoot: string;
	handbookDocs: HandbookDoc[];
	canonicalDocsRoot: string;
	publicRegulationDocs: PublicRegulationDoc[];
}): Promise<void> {
	mkdirSync(input.canonicalDocsRoot, { recursive: true });
	writeText(resolve(input.canonicalDocsRoot, "_meta.json"), formatJsonContent(buildDocsMeta()));
	writeText(
		resolve(input.canonicalDocsRoot, "index.md"),
		buildDocsIndex({
			curriculumCount: input.curriculumDocs.length,
			handbookCount: input.handbookDocs.length,
			publicRegulationCount: input.publicRegulationDocs.length,
		}),
	);
	await syncRegulationsCanonicalDocs(input);
	await syncCurriculumCanonicalDocs(input);
	removeStaleGeneratedFiles(
		input.canonicalDocsRoot,
		new Set(["_meta.json", "index.md", "regulations", "curriculum"]),
	);
}

function buildDocsMeta(): SidebarMetaEntry[] {
	return [
		{ type: "file", name: "index", label: "全部文档" },
		{ type: "dir", name: "regulations", label: "规章制度", collapsed: false },
		{ type: "dir", name: "curriculum", label: "培养方案", collapsed: false },
	];
}

function buildDocsIndex(input: {
	curriculumCount: number;
	handbookCount: number;
	publicRegulationCount: number;
}): string {
	const regulationCount = input.handbookCount + input.publicRegulationCount;
	const totalCount = regulationCount + input.curriculumCount;
	return [
		"---",
		'title: "公开文档总览"',
		"footer: false",
		'documentKind: "home"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 公开文档总览",
		"",
		`当前公开发布 ${totalCount} 篇文档。请选择文档目录中的集合继续阅读。`,
		"",
		`- [规章制度](./regulations/)：${regulationCount} 篇文档`,
		`- [培养方案](./curriculum/)：${input.curriculumCount} 篇文档`,
		"",
	].join("\n");
}

async function syncRegulationsCanonicalDocs(input: {
	client: ObjectStoreClient;
	docsRoot: string;
	handbookDocs: HandbookDoc[];
	canonicalDocsRoot: string;
	publicRegulationDocs: PublicRegulationDoc[];
}): Promise<void> {
	const regulationsDir = resolve(input.canonicalDocsRoot, "regulations");
	const studentRulesDir = resolve(regulationsDir, "student_rules");
	const institutionalRulesDir = resolve(regulationsDir, "institutional_rules");

	writeText(resolve(regulationsDir, "_meta.json"), formatJsonContent(buildRegulationsCorpusMeta()));
	writeText(
		resolve(regulationsDir, "index.md"),
		buildRegulationsCorpusIndex({
			studentRulesCount: input.handbookDocs.length,
			institutionalRulesCount: input.publicRegulationDocs.length,
		}),
	);

	await syncStudentRulesCanonicalDocs({
		client: input.client,
		docsRoot: input.docsRoot,
		handbookDocs: input.handbookDocs,
		targetDir: studentRulesDir,
	});
	await syncInstitutionalRulesCanonicalDocs({
		client: input.client,
		regulationDocs: input.publicRegulationDocs,
		targetDir: institutionalRulesDir,
	});

	removeStaleGeneratedFiles(
		regulationsDir,
		new Set(["_meta.json", "index.md", "student_rules", "institutional_rules"]),
	);
}

function buildRegulationsCorpusMeta(): SidebarMetaEntry[] {
	return [
		{ type: "file", name: "index", label: "规章制度" },
		{ type: "dir", name: "student_rules", label: "学生手册", collapsed: true },
		{ type: "dir", name: "institutional_rules", label: "校内规章", collapsed: true },
	];
}

function buildRegulationsCorpusIndex(input: {
	studentRulesCount: number;
	institutionalRulesCount: number;
}): string {
	const totalCount = input.studentRulesCount + input.institutionalRulesCount;
	return [
		"---",
		'title: "规章制度"',
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 规章制度",
		"",
		`当前公开发布 ${totalCount} 篇文档。`,
		"",
		`- [学生手册](./student_rules/)：${input.studentRulesCount} 篇文档`,
		`- [校内规章](./institutional_rules/)：${input.institutionalRulesCount} 篇文档`,
		"",
	].join("\n");
}

async function syncStudentRulesCanonicalDocs(input: {
	client: ObjectStoreClient;
	docsRoot: string;
	handbookDocs: HandbookDoc[];
	targetDir: string;
}): Promise<void> {
	const flowGraphDocs = await syncHandbookFlowGraphArtifacts({
		client: input.client,
		docsRoot: input.docsRoot,
		routeDepthFromDocsRoot: GROUPED_DOC_ROUTE_DEPTH_FROM_DOCS_ROOT,
		targetDir: input.targetDir,
	});
	const groups = groupHandbookDocs({ flowGraphDocs, handbookDocs: input.handbookDocs });
	writeText(
		resolve(input.targetDir, "_meta.json"),
		formatJsonContent(
			buildHandbookMetaEntries({ flowGraphDocs, handbookDocs: input.handbookDocs }),
		),
	);
	writeText(resolve(input.targetDir, "index.md"), buildStudentRulesIndex(groups));

	for (const doc of input.handbookDocs) {
		const markdown = cleanHandbookMarkdown(
			await input.client.readTextObject({ key: buildHandbookDocKey(doc) }),
		);
		writeText(resolve(input.targetDir, `${doc.slug}.md`), markdown);
	}

	removeStaleGeneratedFiles(
		input.targetDir,
		new Set([
			"_meta.json",
			"index.md",
			...input.handbookDocs.map((doc) => `${doc.slug}.md`),
			...flowGraphDocs.map((doc) => doc.filename),
		]),
	);
}

async function syncInstitutionalRulesCanonicalDocs(input: {
	client: ObjectStoreClient;
	regulationDocs: PublicRegulationDoc[];
	targetDir: string;
}): Promise<void> {
	writeText(
		resolve(input.targetDir, "_meta.json"),
		formatJsonContent(buildInstitutionalRulesMeta(input.regulationDocs)),
	);
	writeText(
		resolve(input.targetDir, "index.md"),
		buildInstitutionalRulesIndex(input.regulationDocs),
	);

	for (const doc of input.regulationDocs) {
		const jsonlText = await input.client.readTextObject({ key: doc.key });
		writeText(
			resolve(input.targetDir, `${doc.slug}.mdx`),
			buildPublicRegulationMarkdown({ doc, jsonlText }),
		);
	}

	removeStaleGeneratedFiles(
		input.targetDir,
		new Set(["_meta.json", "index.md", ...input.regulationDocs.map((doc) => `${doc.slug}.mdx`)]),
	);
}

function buildInstitutionalRulesMeta(regulationDocs: PublicRegulationDoc[]): SidebarMetaEntry[] {
	const grouped = groupInstitutionalRulesDocs(regulationDocs);
	return [
		{ type: "file", name: "index", label: "校内规章" },
		...grouped.flatMap((group) => [
			{ type: "section-header" as const, label: group.displayName },
			...group.docs.map((doc) => ({
				type: "file" as const,
				name: doc.slug,
				label: doc.title,
			})),
		]),
	];
}

function buildInstitutionalRulesIndex(regulationDocs: PublicRegulationDoc[]): string {
	const groups = groupInstitutionalRulesDocs(regulationDocs);
	return [
		"---",
		'title: "校内规章"',
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 校内规章",
		"",
		`当前公开发布 ${regulationDocs.length} 篇文档。`,
		"",
		...groups.flatMap((group) => [
			`## ${group.displayName}`,
			"",
			...group.docs.map((doc) => `- [${doc.title}](./${doc.slug})`),
			"",
		]),
	].join("\n");
}

function buildStudentRulesIndex(
	groups: Array<{ docs: Array<HandbookDoc | HandbookFlowGraphDoc>; id: string; label: string }>,
): string {
	return [
		"---",
		'title: "学生手册"',
		"description: 中央民族大学学生手册公开阅读目录。",
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"这里汇总学生在校学习、生活、资助、纪律、住宿和医疗等常用制度文件。",
		"",
		"你可以从文档目录按文件进入，也可以使用顶部搜索直接查询“转专业”“奖学金”“违纪处分”“公费医疗”等关键词。",
		"",
		...groups.flatMap((group) => {
			if (group.docs.length === 0) {
				return [];
			}
			return [
				`## ${group.label}`,
				"",
				...group.docs.map((doc) => `- [${doc.title}](./${doc.slug})`),
				"",
			];
		}),
	].join("\n");
}

function groupInstitutionalRulesDocs(
	regulationDocs: PublicRegulationDoc[],
): Array<{ displayName: string; docs: PublicRegulationDoc[]; groupId: RegulationNavGroup }> {
	const grouped = new Map<RegulationNavGroup, PublicRegulationDoc[]>();
	const byDocumentId = buildRegulationConsumptionByDocumentId();
	for (const doc of regulationDocs) {
		const groupId = byDocumentId.get(doc.documentId)?.docs_nav_group ?? doc.docsNavGroup;
		grouped.set(groupId, [...(grouped.get(groupId) ?? []), doc]);
	}
	return (["student", "public_service", "staff_governance"] as const)
		.map((groupId) => ({
			displayName: resolveRegulationGroupMeta(groupId).displayName,
			docs: (grouped.get(groupId) ?? []).sort((left, right) =>
				left.title.localeCompare(right.title, "zh-CN"),
			),
			groupId,
		}))
		.filter((group) => group.docs.length > 0);
}

async function syncCurriculumCanonicalDocs(input: {
	client: ObjectStoreClient;
	curriculumDocs: CurriculumDoc[];
	docsRoot: string;
	canonicalDocsRoot: string;
}): Promise<void> {
	const curriculumDir = resolve(input.canonicalDocsRoot, "curriculum");
	const collectionDir = resolve(curriculumDir, "curriculum_plan");
	const courseMapEmbeds = await syncCurriculumCourseMapArtifacts({
		client: input.client,
		curriculumDocs: input.curriculumDocs,
		docsRoot: input.docsRoot,
	});

	writeText(resolve(curriculumDir, "_meta.json"), formatJsonContent(buildCurriculumCorpusMeta()));
	writeText(
		resolve(curriculumDir, "index.md"),
		buildCurriculumCorpusIndex(input.curriculumDocs.length),
	);
	writeText(
		resolve(collectionDir, "_meta.json"),
		formatJsonContent(buildCurriculumMetaEntries(input.curriculumDocs)),
	);
	writeText(resolve(collectionDir, "index.md"), buildCurriculumPlanIndex(input.curriculumDocs));

	for (const doc of input.curriculumDocs) {
		const jsonlText = await input.client.readTextObject({ key: doc.key });
		const courseMapEmbed = courseMapEmbeds.get(doc.slug);
		const markdown = buildCurriculumMarkdown({
			courseMapEmbed: courseMapEmbed
				? buildCourseMapDocEmbedForRoute({
						dataImportName: courseMapEmbed.dataImportName,
						routeDepthFromDocsRoot: GROUPED_DOC_ROUTE_DEPTH_FROM_DOCS_ROOT,
						slug: doc.slug,
					})
				: undefined,
			jsonlText,
			objectKey: doc.key,
			slug: doc.slug,
			title: doc.title,
		});
		writeText(resolve(collectionDir, `${doc.slug}.mdx`), markdown);
	}

	removeStaleGeneratedFiles(
		collectionDir,
		new Set(["_meta.json", "index.md", ...input.curriculumDocs.map((doc) => `${doc.slug}.mdx`)]),
	);
	removeStaleGeneratedFiles(curriculumDir, new Set(["_meta.json", "index.md", "curriculum_plan"]));
}

function buildCurriculumCorpusMeta(): SidebarMetaEntry[] {
	return [
		{ type: "file", name: "index", label: "培养方案" },
		{ type: "dir", name: "curriculum_plan", label: "培养方案", collapsed: true },
	];
}

function buildCurriculumCorpusIndex(curriculumCount: number): string {
	return [
		"---",
		'title: "培养方案"',
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 培养方案",
		"",
		`当前公开发布 ${curriculumCount} 篇文档。`,
		"",
		`- [培养方案](./curriculum_plan/)：${curriculumCount} 篇文档`,
		"",
	].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	syncRealDocs().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}

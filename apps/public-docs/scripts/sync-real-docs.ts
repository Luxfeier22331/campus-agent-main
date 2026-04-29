import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
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
	buildHandbookIndex,
	cleanHandbookMarkdown,
	loadHandbookDocs,
} from "./sync-real-docs/handbook";
import { syncHandbookFlowGraphArtifacts } from "./sync-real-docs/handbook-flow-graph";
import { groupHandbookDocs } from "./sync-real-docs/ia";
import { buildHomePage } from "./sync-real-docs/pages";
import {
	discoverPublicRegulationDocs,
	syncPublicRegulationDocs,
} from "./sync-real-docs/regulations";
import {
	type CurriculumDoc,
	DOCS_ROOT,
	formatJsonContent,
	type HandbookDoc,
	type HandbookFlowGraphDoc,
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

const GROUPED_DOC_ROUTE_DEPTH_FROM_DOCS_ROOT = 2;

export async function syncRealDocs(): Promise<void> {
	loadPublicDocsEnv();
	const client = createS3ObjectStore();
	const handbookDocs = loadHandbookDocs();
	const curriculumDocs = await discoverCurriculumDocs(client);
	const publicRegulationDocs = await discoverPublicRegulationDocs(client);

	removeLegacySectionDirs(DOCS_ROOT);
	writeText(
		resolve(DOCS_ROOT, "_meta.json"),
		formatJsonContent(
			buildTopLevelMetaEntries({ includePublicRegulations: publicRegulationDocs.length > 0 }),
		),
	);
	writeText(
		resolve(DOCS_ROOT, "index.md"),
		buildHomePage({ includePublicRegulations: publicRegulationDocs.length > 0 }),
	);
	await syncHandbookDocs(client, handbookDocs);
	await syncCurriculumDocs(client, curriculumDocs);
	await syncPublicRegulationDocs({
		client,
		docsRoot: DOCS_ROOT,
		regulationDocs: publicRegulationDocs,
	});
}

export function buildTopLevelMetaEntries(input: {
	includePublicRegulations: boolean;
}): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [
		{ type: "file", name: "index", label: "文档首页" },
		{ type: "dir", name: "student-handbook", label: "学生手册", collapsed: true },
		{ type: "dir", name: "curriculum-plan", label: "培养方案", collapsed: true },
	];
	if (input.includePublicRegulations) {
		entries.push({
			type: "dir",
			name: "campus-regulations",
			label: "校内规章",
			collapsed: true,
		});
	}
	return entries;
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
		entries.push({ type: "dir", name: group.id, label: group.label, collapsed: true });
	}
	return entries;
}

export function buildCurriculumMetaEntries(curriculumDocs: CurriculumDoc[]): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [];
	for (const group of groupCurriculumDocs(curriculumDocs)) {
		if (group.docs.length === 0) {
			continue;
		}
		entries.push({ type: "dir", name: group.id, label: group.label, collapsed: true });
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

async function syncHandbookDocs(
	client: ObjectStoreClient,
	handbookDocs: HandbookDoc[],
): Promise<void> {
	const targetDir = resolve(DOCS_ROOT, "student-handbook");
	mkdirSync(targetDir, { recursive: true });
	const workflowsDir = resolve(targetDir, "workflows");
	mkdirSync(workflowsDir, { recursive: true });
	const flowGraphDocs = await syncHandbookFlowGraphArtifacts({
		client,
		docsRoot: DOCS_ROOT,
		routeDepthFromDocsRoot: GROUPED_DOC_ROUTE_DEPTH_FROM_DOCS_ROOT,
		targetDir: workflowsDir,
	});
	const groups = groupHandbookDocs({ flowGraphDocs, handbookDocs });
	writeText(
		resolve(targetDir, "_meta.json"),
		formatJsonContent(buildHandbookMetaEntries({ flowGraphDocs, handbookDocs })),
	);
	writeText(resolve(targetDir, "index.md"), buildHandbookIndex());

	for (const group of groups) {
		if (group.docs.length === 0) {
			continue;
		}
		const groupDir = resolve(targetDir, group.id);
		mkdirSync(groupDir, { recursive: true });
		writeText(
			resolve(groupDir, "_meta.json"),
			formatJsonContent(buildGroupMetaEntries(group.docs)),
		);
		for (const doc of group.docs) {
			if (!isHandbookDoc(doc)) {
				continue;
			}
			const markdown = cleanHandbookMarkdown(
				await client.readTextObject({ key: buildHandbookDocKey(doc) }),
			);
			writeText(resolve(groupDir, `${doc.slug}.md`), markdown);
		}
		removeStaleGeneratedFiles(
			groupDir,
			new Set([
				"_meta.json",
				...group.docs.map((doc) => ("filename" in doc ? doc.filename : `${doc.slug}.md`)),
			]),
		);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set([
			"_meta.json",
			"index.md",
			...groups.filter((group) => group.docs.length > 0).map((group) => group.id),
		]),
	);
}

async function syncCurriculumDocs(
	client: ObjectStoreClient,
	curriculumDocs: CurriculumDoc[],
): Promise<void> {
	const targetDir = resolve(DOCS_ROOT, "curriculum-plan");
	mkdirSync(targetDir, { recursive: true });
	const courseMapEmbeds = await syncCurriculumCourseMapArtifacts({
		client,
		curriculumDocs,
		docsRoot: DOCS_ROOT,
	});
	const groups = groupCurriculumDocs(curriculumDocs);
	writeText(
		resolve(targetDir, "_meta.json"),
		formatJsonContent(buildCurriculumMetaEntries(curriculumDocs)),
	);
	writeText(resolve(targetDir, "index.md"), buildCurriculumPlanIndex(curriculumDocs));
	for (const group of groups) {
		if (group.docs.length === 0) {
			continue;
		}
		const groupDir = resolve(targetDir, group.id);
		mkdirSync(groupDir, { recursive: true });
		writeText(
			resolve(groupDir, "_meta.json"),
			formatJsonContent(buildGroupMetaEntries(group.docs)),
		);
		for (const doc of group.docs) {
			const jsonlText = await client.readTextObject({ key: doc.key });
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
			writeText(resolve(groupDir, `${doc.slug}.mdx`), markdown);
		}
		removeStaleGeneratedFiles(
			groupDir,
			new Set(["_meta.json", ...group.docs.map((doc) => `${doc.slug}.mdx`)]),
		);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set([
			"_meta.json",
			"index.md",
			...groups.filter((group) => group.docs.length > 0).map((group) => group.id),
		]),
	);
}

function isHandbookDoc(doc: HandbookDoc | HandbookFlowGraphDoc): doc is HandbookDoc {
	return !("filename" in doc);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	syncRealDocs().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}

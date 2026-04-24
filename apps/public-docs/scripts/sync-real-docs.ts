import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { syncCurriculumCourseMapArtifacts } from "./sync-real-docs/course-map";
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
	| { type: "dir"; name: string; label: string }
	| { type: "section-header"; label: string };

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
		{ type: "dir", name: "student-handbook", label: "学生手册" },
		{ type: "dir", name: "curriculum-plan", label: "培养方案" },
	];
	if (input.includePublicRegulations) {
		entries.push({ type: "dir", name: "campus-regulations", label: "校内规章" });
	}
	return entries;
}

export function buildHandbookMetaEntries(input: {
	flowGraphDocs: HandbookFlowGraphDoc[];
	handbookDocs: HandbookDoc[];
}): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [{ type: "file", name: "index", label: "学生手册概览" }];
	if (input.flowGraphDocs.length > 0) {
		entries.push(
			{ type: "section-header", label: "办事流程" },
			...input.flowGraphDocs.map((doc) => ({
				type: "file" as const,
				name: doc.slug,
				label: doc.title,
			})),
		);
	}
	entries.push(
		{ type: "section-header", label: "学生手册目录" },
		...input.handbookDocs.map((doc) => ({
			type: "file" as const,
			name: doc.slug,
			label: doc.title,
		})),
	);
	return entries;
}

export function buildCurriculumMetaEntries(curriculumDocs: CurriculumDoc[]): SidebarMetaEntry[] {
	const entries: SidebarMetaEntry[] = [{ type: "file", name: "index", label: "培养方案概览" }];
	for (const group of groupCurriculumDocs(curriculumDocs)) {
		if (group.docs.length === 0) {
			continue;
		}
		entries.push(
			{ type: "section-header", label: group.label },
			...group.docs.map((doc) => ({
				type: "file" as const,
				name: doc.slug,
				label: doc.title,
			})),
		);
	}
	return entries;
}

async function syncHandbookDocs(
	client: ObjectStoreClient,
	handbookDocs: HandbookDoc[],
): Promise<void> {
	const targetDir = resolve(DOCS_ROOT, "student-handbook");
	mkdirSync(targetDir, { recursive: true });
	const flowGraphDocs = await syncHandbookFlowGraphArtifacts({ client, docsRoot: DOCS_ROOT });
	writeText(
		resolve(targetDir, "_meta.json"),
		formatJsonContent(buildHandbookMetaEntries({ flowGraphDocs, handbookDocs })),
	);
	writeText(resolve(targetDir, "index.md"), buildHandbookIndex());
	for (const doc of handbookDocs) {
		const markdown = cleanHandbookMarkdown(
			await client.readTextObject({ key: buildHandbookDocKey(doc) }),
		);
		writeText(resolve(targetDir, `${doc.slug}.md`), markdown);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set([
			"_meta.json",
			"index.md",
			...handbookDocs.map((doc) => `${doc.slug}.md`),
			...flowGraphDocs.map((doc) => doc.filename),
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
	writeText(
		resolve(targetDir, "_meta.json"),
		formatJsonContent(buildCurriculumMetaEntries(curriculumDocs)),
	);
	writeText(resolve(targetDir, "index.md"), buildCurriculumPlanIndex(curriculumDocs));
	for (const doc of curriculumDocs) {
		const jsonlText = await client.readTextObject({ key: doc.key });
		const markdown = buildCurriculumMarkdown({
			courseMapEmbed: courseMapEmbeds.get(doc.slug),
			jsonlText,
			slug: doc.slug,
			title: doc.title,
		});
		writeText(resolve(targetDir, `${doc.slug}.mdx`), markdown);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set(["_meta.json", "index.md", ...curriculumDocs.map((doc) => `${doc.slug}.mdx`)]),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	syncRealDocs().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}

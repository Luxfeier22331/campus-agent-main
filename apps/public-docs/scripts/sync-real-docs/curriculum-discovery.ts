import { iterRows } from "./curriculum-markdown-patterns";
import {
	CURRICULUM_GROUPS,
	type CurriculumDocGroupId,
	classifyCurriculumDocGroupId,
	groupCurriculumDocsByIa,
} from "./ia";
import {
	buildReaderFrontmatterLines,
	CURRICULUM_DOC_SLUG_OVERRIDES,
	type CurriculumDoc,
	normalizeText,
	sha1Hex,
} from "./shared";
import type { ObjectStoreClient } from "./storage";

export function buildCurriculumPlanIndex(curriculumDocs: CurriculumDoc[] = []): string {
	const groups = groupCurriculumDocs(curriculumDocs);
	const lines = [
		"---",
		"title: 培养方案目录",
		"description: 中央民族大学公开培养方案目录。",
		"footer: false",
		...buildReaderFrontmatterLines({
			kind: "collectionLanding",
			layout: "landing",
			measure: "standard",
			outlinePolicy: "none",
		}),
		"outline: false",
		"---",
		"",
		"这里汇总可公开阅读的培养方案、通识课程教学计划与专项培养文件。你可以使用顶部搜索按专业名称、课程类别或关键词快速定位内容。",
		"",
	];
	for (const group of groups) {
		if (group.docs.length === 0) {
			continue;
		}
		lines.push(`## ${group.label}`, "");
		for (const doc of group.docs) {
			lines.push(`- [${doc.title}](./${group.id}/${doc.slug})`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export function groupCurriculumDocs(curriculumDocs: CurriculumDoc[]): CurriculumDocGroup[] {
	return groupCurriculumDocsByIa(curriculumDocs) as CurriculumDocGroup[];
}

export type CurriculumDocGroupLabel =
	| "本科专业与专业类"
	| "实验班与专项培养"
	| "强基计划"
	| "第二学士学位"
	| "通识课程"
	| "其他培养方案";

export interface CurriculumDocGroup {
	id: CurriculumDocGroupId;
	label: CurriculumDocGroupLabel;
	docs: CurriculumDoc[];
}

export function classifyCurriculumDocGroup(title: string): CurriculumDocGroupLabel {
	const groupId = classifyCurriculumDocGroupId(title);
	const group = CURRICULUM_GROUPS.find((candidate) => candidate.id === groupId);
	return (group?.label ?? "其他培养方案") as CurriculumDocGroupLabel;
}

export async function discoverCurriculumDocs(client: ObjectStoreClient): Promise<CurriculumDoc[]> {
	const keys = await client.listObjectKeys({ prefix: "curriculum/documents/curriculum_plan/" });
	const docs: CurriculumDoc[] = [];
	const seenSlugs = new Set<string>();
	for (const key of keys) {
		if (!key.endsWith("/document-units.jsonl")) {
			continue;
		}
		const jsonlText = await client.readTextObject({ key });
		const docId = resolveCurriculumDocId(jsonlText, key);
		const title = resolveCurriculumDocTitle(jsonlText, key);
		let slug = buildCurriculumDocSlug({ docId, title });
		if (seenSlugs.has(slug)) {
			slug = `${slug}-${sha1Hex(docId).slice(0, 10)}`;
		}
		if (seenSlugs.has(slug)) {
			throw new Error(`duplicate curriculum slug discovered: ${slug}`);
		}
		seenSlugs.add(slug);
		docs.push({ key, slug, title });
	}
	return docs.sort((left, right) => {
		const leftSort = sortCurriculumTitle(left.title);
		const rightSort = sortCurriculumTitle(right.title);
		if (leftSort[0] !== rightSort[0]) {
			return leftSort[0] - rightSort[0];
		}
		if (leftSort[1] < rightSort[1]) {
			return -1;
		}
		if (leftSort[1] > rightSort[1]) {
			return 1;
		}
		return 0;
	});
}

export function resolveCurriculumDocTitle(jsonlText: string, key: string): string {
	let docId = "";
	for (const row of iterRows(jsonlText)) {
		if (!docId) {
			docId = normalizeText(row.doc_id);
		}
		if (String(row.row_type ?? "") === "heading") {
			const headingText = normalizeText(row.clean_text);
			if (headingText) {
				return headingText;
			}
		}
	}
	if (docId.startsWith("curriculum:")) {
		return docId.split(":", 2)[1]?.trim() ?? "";
	}
	throw new Error(`unable to resolve curriculum title from: ${key}`);
}

function resolveCurriculumDocId(jsonlText: string, key: string): string {
	for (const row of iterRows(jsonlText)) {
		const docId = normalizeText(row.doc_id);
		if (docId) {
			return docId;
		}
	}
	throw new Error(`doc_id is required in curriculum document-units: ${key}`);
}

function buildCurriculumDocSlug(input: { docId: string; title: string }): string {
	const override = CURRICULUM_DOC_SLUG_OVERRIDES.get(input.docId);
	if (override) {
		return override;
	}
	const slug = input.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	return slug || `curriculum-plan-${sha1Hex(input.docId).slice(0, 10)}`;
}

function sortCurriculumTitle(title: string): [number, string] {
	return [title.includes("本科人才培养方案") ? 0 : 1, title];
}

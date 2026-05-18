import {
	convertTableHtmlToMarkdownBlocks,
	normalizeTableBodyHeaderCells,
} from "./sync-real-docs/html-table";
import { normalizeReadableText } from "./sync-real-docs/readable-text";
import { escapeHtmlText } from "./sync-real-docs/shared";

export interface PublishedReaderDocRenderEntry {
	collection: string;
	corpus: string;
	docId?: string;
	documentSlug: string;
	isCurrent: boolean;
	title: string;
	versionId?: string;
	versionLabel?: string;
	versionSlug: string;
}

export interface ReaderPayload {
	document?: {
		collection?: string;
		corpus?: string;
		documentSlug?: string;
		title?: string;
	};
	sections?: Array<{
		anchor?: string;
		blocks?: Array<{
			kind?: string;
			rootUnitId?: string;
			text?: string;
		}>;
		order?: number;
		title?: string;
	}>;
}

export interface ReaderMetaPayload {
	pageLabel?: string;
	resolvedVersion?: {
		label?: string;
	};
	source?: {
		pageLabel?: string;
		title?: string;
	};
	sourceLabel?: string;
	title?: string;
}

interface RenderedReaderBlock {
	tableHtml: boolean;
	text: string;
}

export function buildReaderMdx(input: {
	entry: PublishedReaderDocRenderEntry;
	meta: ReaderMetaPayload;
	reader: ReaderPayload;
}): string {
	const title = input.reader.document?.title || input.entry.title;
	const lines = [
		"---",
		`title: ${JSON.stringify(title)}`,
		"footer: false",
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		`readerLayout: ${JSON.stringify(resolveReaderLayout(input.entry))}`,
		`readerMeasure: ${JSON.stringify(resolveReaderMeasure(input.entry))}`,
		'readerOutline: "document"',
		"---",
		"",
		buildMetaPanel({ entry: input.entry, meta: input.meta }),
		"",
	];

	for (const section of input.reader.sections ?? []) {
		const anchor = String(section.anchor ?? "").trim();
		if (anchor) {
			lines.push(`<span id="${escapeHtmlText(anchor)}"></span>`, "");
		}
		const sectionTitle = normalizeReadableText(String(section.title ?? "").trim());
		if (sectionTitle && sectionTitle !== title) {
			lines.push(`## ${sectionTitle}`, "");
		}
		for (const block of section.blocks ?? []) {
			const renderedBlock = renderReaderBlock(String(block.text ?? "").trim());
			if (!renderedBlock.text) {
				continue;
			}
			const rootUnitId = String(block.rootUnitId ?? "").trim();
			if (renderedBlock.tableHtml) {
				if (rootUnitId) {
					lines.push(
						`<span className="reader-block-root" data-root-unit-id="${escapeHtmlText(rootUnitId)}"></span>`,
						"",
					);
				}
				lines.push(renderedBlock.text, "");
				continue;
			}
			lines.push(
				`<div className="reader-block" data-root-unit-id="${escapeHtmlText(rootUnitId)}">`,
				"",
				renderedBlock.text,
				"",
				"</div>",
				"",
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function renderReaderBlock(raw: string): RenderedReaderBlock {
	const normalized = normalizeReadableText(raw);
	if (!normalized) {
		return { tableHtml: false, text: "" };
	}
	if (isCompleteTableHtml(normalized)) {
		const tableHtml = normalizeTableBodyHeaderCells(normalized);
		return { tableHtml: true, text: renderTableBlockText(tableHtml) };
	}
	return { tableHtml: false, text: escapeHtmlText(normalized) };
}

function isCompleteTableHtml(text: string): boolean {
	return /<table\b[\s\S]*<\/table>/i.test(text);
}

function hasBalancedTableTags(text: string): boolean {
	return (
		tagCount(text, /<table\b/gi) === tagCount(text, /<\/table>/gi) &&
		tagCount(text, /<tr\b/gi) === tagCount(text, /<\/tr>/gi) &&
		tagCount(text, /<td\b/gi) === tagCount(text, /<\/td>/gi) &&
		tagCount(text, /<th\b/gi) === tagCount(text, /<\/th>/gi)
	);
}

function tagCount(text: string, pattern: RegExp): number {
	return [...text.matchAll(pattern)].length;
}

function flattenTableHtmlToText(html: string): string {
	return html
		.replace(/<\/tr>/gi, "\n")
		.replace(/<\/t[dh]>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function renderTableBlockText(tableHtml: string): string {
	const flattened = flattenTableHtmlToText(tableHtml);
	if (!hasBalancedTableTags(tableHtml)) {
		return escapeHtmlText(flattened);
	}
	const converted = convertTableHtmlToMarkdownBlocks(tableHtml)
		.map(([, blockText]) => blockText.trim())
		.filter(Boolean)
		.join("\n\n")
		.trim();
	if (!converted) {
		return escapeHtmlText(flattened);
	}
	if (/<[^>\n]{0,120}>/.test(converted)) {
		return escapeHtmlText(flattened);
	}
	return converted;
}

function buildMetaPanel(input: {
	entry: PublishedReaderDocRenderEntry;
	meta: ReaderMetaPayload;
}): string {
	const versionLabel =
		input.entry.versionLabel || input.meta.resolvedVersion?.label || "当前展示版";
	const collectionLabel = resolveCollectionLabel(input.entry);
	const sourceTitle = input.meta.source?.title || input.meta.sourceLabel;
	const pageLabel = input.meta.source?.pageLabel || input.meta.pageLabel;
	const visibleItems = [
		versionLabel,
		`来源：${collectionLabel}`,
		...(pageLabel ? [pageLabel] : []),
	];
	const details = [
		["文档集合", collectionLabel],
		["版本", versionLabel],
		...(sourceTitle ? ([["来源文件", sourceTitle]] as const) : []),
		...(pageLabel ? ([["原文位置", pageLabel]] as const) : []),
		...(input.entry.docId ? ([["doc_id", input.entry.docId]] as const) : []),
		...(input.entry.versionId ? ([["version_id", input.entry.versionId]] as const) : []),
	];
	return [
		`<section className="document-meta-panel" aria-label="文档来源与版本" data-docs-reader-meta="true" data-docs-corpus="${escapeHtmlText(input.entry.corpus)}" data-docs-collection="${escapeHtmlText(input.entry.collection)}" data-docs-document-slug="${escapeHtmlText(input.entry.documentSlug)}" data-docs-version-slug="${escapeHtmlText(input.entry.versionSlug)}" data-docs-is-current="${input.entry.isCurrent ? "true" : "false"}">`,
		'\t<p className="document-meta-summary">',
		...visibleItems.map((item) => `\t\t<span>${escapeHtmlText(item)}</span>`),
		"\t</p>",
		'\t<details className="document-meta-details">',
		"\t\t<summary>来源详情</summary>",
		"\t\t<dl>",
		...details.flatMap(([label, value]) => [
			"\t\t\t<div>",
			`\t\t\t\t<dt>${escapeHtmlText(label)}</dt>`,
			`\t\t\t\t<dd>${escapeHtmlText(value)}</dd>`,
			"\t\t\t</div>",
		]),
		"\t\t</dl>",
		"\t</details>",
		"</section>",
	].join("\n");
}

function resolveDocumentKind(entry: PublishedReaderDocRenderEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "curriculumPlan";
	}
	if (entry.collection === "student_rules") {
		return "studentHandbookArticle";
	}
	return "publicRegulation";
}

function resolveReaderLayout(entry: PublishedReaderDocRenderEntry): string {
	return entry.collection === "curriculum_plan" ? "tabular" : "article";
}

function resolveReaderMeasure(entry: PublishedReaderDocRenderEntry): string {
	return entry.collection === "curriculum_plan" ? "wide" : "standard";
}

export function resolveCorpusLabel(corpus: string): string {
	return corpus === "curriculum" ? "培养方案" : corpus === "regulations" ? "规章制度" : corpus;
}

export function resolveCollectionLabel(entry: { collection: string; corpus: string }): string {
	if (entry.collection === "curriculum_plan") {
		return "培养方案";
	}
	if (entry.collection === "student_rules") {
		return "学生手册";
	}
	if (entry.collection === "institutional_rules") {
		return "校级规章";
	}
	if (entry.collection === "scoped_rules") {
		return "专项规章";
	}
	return entry.collection;
}

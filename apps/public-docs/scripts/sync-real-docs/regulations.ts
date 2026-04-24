import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
	formatJsonContent,
	jsonString,
	normalizeText,
	type PublicRegulationDoc,
	removeStaleGeneratedFiles,
	sha1Hex,
	writeText,
} from "./shared";
import type { ObjectStoreClient } from "./storage";

const PUBLIC_REGULATION_COLLECTIONS = new Map<string, string>([
	["institutional_rules", "学校规章"],
	["scoped_rules", "专项规则"],
]);
const REGULATION_ROUTE_PREFIX = "campus-regulation";
const MARKDOWN_HEADING_RE = /^\s*#+\s*(?<text>.+?)\s*$/;

export function buildPublicRegulationIndex(): string {
	return [
		"---",
		"title: 校内规章",
		"description: 当前公开阅读面中已显式 admission 的校内规章目录。",
		"---",
		"",
		"这里仅展示已明确标记为公开可发布的规章制度文档。",
		"",
		"认证内网来源、带有受限 entitlement 的制度文档不会进入当前公开文档站。",
		"",
	].join("\n");
}

export async function discoverPublicRegulationDocs(
	client: ObjectStoreClient,
): Promise<PublicRegulationDoc[]> {
	const docs: PublicRegulationDoc[] = [];
	const seenSlugs = new Set<string>();
	for (const [collection, collectionLabel] of PUBLIC_REGULATION_COLLECTIONS) {
		const prefix = `regulations/documents/${collection}/`;
		for (const key of await client.listObjectKeys({ prefix })) {
			if (!key.endsWith("/document-units.jsonl")) {
				continue;
			}
			const jsonlText = await client.readTextObject({ key });
			if (!isExplicitPublicRegulationDoc(jsonlText)) {
				continue;
			}
			const docId = resolveRegulationDocId(jsonlText, key);
			const title = resolveRegulationDocTitle(jsonlText, key);
			let slug = buildPublicRegulationDocSlug({ collection, docId, title });
			if (seenSlugs.has(slug)) {
				slug = `${slug}-${sha1Hex(docId).slice(0, 10)}`;
			}
			if (seenSlugs.has(slug)) {
				throw new Error(`duplicate public regulation slug discovered: ${slug}`);
			}
			seenSlugs.add(slug);
			docs.push({ collection, collectionLabel, key, slug, title });
		}
	}
	return docs.sort(
		(left, right) =>
			left.collectionLabel.localeCompare(right.collectionLabel, "zh-CN") ||
			left.title.localeCompare(right.title, "zh-CN"),
	);
}

export function buildPublicRegulationMarkdown(input: {
	doc: PublicRegulationDoc;
	jsonlText: string;
}): string {
	const lines = [
		"---",
		`title: ${jsonString(input.doc.title)}`,
		"corpus: regulations",
		`collection: ${input.doc.collection}`,
		`collectionLabel: ${jsonString(input.doc.collectionLabel)}`,
		"---",
		"",
	];
	let wroteBody = false;
	for (const row of iterRows(input.jsonlText)) {
		const rowType = String(row.row_type ?? "").trim();
		const text = normalizeText(row.clean_text);
		if (!text || rowType === "page_number") {
			continue;
		}
		if (rowType === "heading") {
			const headingText = normalizeHeadingText(text);
			if (headingText === input.doc.title && !wroteBody) {
				continue;
			}
			lines.push(`## ${headingText}`, "");
			wroteBody = true;
			continue;
		}
		if (rowType === "table") {
			lines.push(normalizeText(row.html) || text, "");
			wroteBody = true;
			continue;
		}
		lines.push(text, "");
		wroteBody = true;
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export async function syncPublicRegulationDocs(input: {
	client: ObjectStoreClient;
	docsRoot: string;
	regulationDocs?: PublicRegulationDoc[];
}): Promise<PublicRegulationDoc[]> {
	const targetDir = resolve(input.docsRoot, "campus-regulations");
	const regulationDocs = input.regulationDocs ?? (await discoverPublicRegulationDocs(input.client));
	if (regulationDocs.length === 0) {
		if (existsSync(targetDir)) {
			rmSync(targetDir, { force: true, recursive: true });
		}
		return [];
	}
	writeText(
		resolve(targetDir, "_meta.json"),
		formatJsonContent(["index", ...regulationDocs.map((doc) => doc.slug)]),
	);
	writeText(resolve(targetDir, "index.md"), buildPublicRegulationIndex());
	for (const doc of regulationDocs) {
		const jsonlText = await input.client.readTextObject({ key: doc.key });
		writeText(
			resolve(targetDir, `${doc.slug}.md`),
			buildPublicRegulationMarkdown({ doc, jsonlText }),
		);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set(["_meta.json", "index.md", ...regulationDocs.map((doc) => `${doc.slug}.md`)]),
	);
	return regulationDocs;
}

function isExplicitPublicRegulationDoc(jsonlText: string): boolean {
	const rows = [...iterRows(jsonlText)];
	if (rows.length === 0) {
		return false;
	}
	for (const row of rows) {
		if (normalizeText(row.visibility_level) !== "public") {
			return false;
		}
		const entitlementGroups = row.entitlement_groups;
		if (Array.isArray(entitlementGroups) && entitlementGroups.length > 0) {
			return false;
		}
		if (
			entitlementGroups !== undefined &&
			entitlementGroups !== null &&
			!(Array.isArray(entitlementGroups) && entitlementGroups.length === 0)
		) {
			return false;
		}
	}
	return true;
}

function resolveRegulationDocId(jsonlText: string, key: string): string {
	for (const row of iterRows(jsonlText)) {
		const docId = normalizeText(row.doc_id);
		if (docId) {
			return docId;
		}
	}
	throw new Error(`doc_id is required in regulation document-units: ${key}`);
}

function resolveRegulationDocTitle(jsonlText: string, key: string): string {
	let docId = "";
	for (const row of iterRows(jsonlText)) {
		if (!docId) {
			docId = normalizeText(row.doc_id);
		}
		const metadata =
			row.metadata && typeof row.metadata === "object"
				? (row.metadata as Record<string, unknown>)
				: undefined;
		const metadataTitle = normalizeText(metadata?.title);
		if (metadataTitle) {
			return metadataTitle;
		}
		if (String(row.row_type ?? "") === "heading") {
			const headingText = normalizeHeadingText(row.clean_text);
			if (headingText) {
				return headingText;
			}
		}
	}
	if (docId) {
		const parts = docId.split(":");
		return parts.length > 1 ? (parts.at(-2) ?? docId) : docId;
	}
	throw new Error(`unable to resolve regulation title from: ${key}`);
}

function buildPublicRegulationDocSlug(input: {
	collection: string;
	docId: string;
	title: string;
}): string {
	const titleSlug = input.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	const collectionSlug = input.collection.replaceAll("_", "-");
	if (titleSlug) {
		return `${REGULATION_ROUTE_PREFIX}-${collectionSlug}-${titleSlug}`;
	}
	return `${REGULATION_ROUTE_PREFIX}-${collectionSlug}-${sha1Hex(input.docId).slice(0, 10)}`;
}

function normalizeHeadingText(value: unknown): string {
	const text = normalizeText(value);
	return MARKDOWN_HEADING_RE.exec(text)?.groups?.text.trim() ?? text;
}

function* iterRows(jsonlText: string): Generator<Record<string, unknown>> {
	for (const line of jsonlText.split(/\r?\n/)) {
		const stripped = line.trim();
		if (stripped) {
			yield JSON.parse(stripped) as Record<string, unknown>;
		}
	}
}

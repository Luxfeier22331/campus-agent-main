import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildRegulationConsumptionByDocumentId,
	resolveRegulationGroupMeta,
	type RegulationNavGroup,
} from "../regulation-consumption";
import { normalizeReadableText } from "./readable-text";
import {
	buildDocumentMetaPanelBlock,
	buildDocumentReaderMetadataFromJsonl,
	buildReaderFrontmatterLines,
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
	["student_rules", "学生规章"],
]);
const REGULATION_ROUTE_PREFIX = "campus-regulation";
const MARKDOWN_HEADING_RE = /^\s*#+\s*(?<text>.+?)\s*$/;

export function buildPublicRegulationIndex(): string {
	return [
		"---",
		"title: 校内规章",
		"description: 当前公开阅读面中已显式 admission 的校内规章目录。",
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
		"这里仅展示已明确标记为公开可发布的规章制度文档。",
		"",
		"认证内网来源、带有受限 entitlement 的制度文档不会进入当前公开文档站。",
		"",
		"- [学生规章](./student/)",
		"- [校园服务制度](./public-service/)",
		"- [教职工与校级治理](./staff-governance/)",
	].join("\n");
}

export async function discoverPublicRegulationDocs(
	client: ObjectStoreClient,
): Promise<PublicRegulationDoc[]> {
	const docs: PublicRegulationDoc[] = [];
	const docsByDocumentId = new Map<string, PublicRegulationDoc>();
	const seenSlugs = new Set<string>();
	const consumptionByDocumentId = buildRegulationConsumptionByDocumentId();
	const discoveredDocumentIds = new Set<string>();
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
			const consumption = consumptionByDocumentId.get(docId);
			if (!consumption) {
				continue;
			}
			const existingDoc = docsByDocumentId.get(docId);
			if (existingDoc) {
				throw new Error(
					[
						`duplicate canonical public regulation documents for ${docId}`,
						`first=${existingDoc.key}`,
						`second=${key}`,
					].join(": "),
				);
			}
			discoveredDocumentIds.add(docId);
			const title = resolveRegulationDocTitle(jsonlText, key);
			let slug = buildPublicRegulationDocSlug({ collection, docId, title });
			if (seenSlugs.has(slug)) {
				slug = `${slug}-${sha1Hex(docId).slice(0, 10)}`;
			}
			if (seenSlugs.has(slug)) {
				throw new Error(`duplicate public regulation slug discovered: ${slug}`);
			}
			seenSlugs.add(slug);
			const doc = {
				audienceSegment: consumption.audience_segment,
				collection,
				collectionLabel,
				docsNavGroup: consumption.docs_nav_group,
				documentId: docId,
				key,
				slug,
				title,
			};
			docsByDocumentId.set(docId, doc);
			docs.push(doc);
		}
	}
	assertPublicRegulationConsumptionCoverage(discoveredDocumentIds);
	return docs.sort(
		(left, right) =>
			left.docsNavGroup.localeCompare(right.docsNavGroup, "zh-CN") ||
			left.title.localeCompare(right.title, "zh-CN"),
	);
}

function assertPublicRegulationConsumptionCoverage(discoveredDocumentIds: ReadonlySet<string>): void {
	const missing = [...buildRegulationConsumptionByDocumentId().values()].filter(
		(entry) => !discoveredDocumentIds.has(entry.document_id),
	);
	if (missing.length === 0) {
		return;
	}
	const examples = missing
		.slice(0, 8)
		.map((entry) => `${entry.title} <${entry.document_id}>`)
		.join("; ");
	throw new Error(
		`public regulation consumption manifest has ${missing.length} canonical document gaps: ${examples}`,
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
		"footer: false",
		...buildReaderFrontmatterLines({
			kind: "publicRegulation",
			layout: "reference",
			measure: "wide",
		}),
		`collectionLabel: ${jsonString(resolvePublicRegulationCollectionLabel(input.doc))}`,
		"---",
		"",
		buildDocumentMetaPanelBlock(
			buildDocumentReaderMetadataFromJsonl({
				collectionLabel: resolvePublicRegulationCollectionLabel(input.doc),
				jsonlText: input.jsonlText,
				objectKey: input.doc.key,
			}),
		),
		"",
	];
	let wroteBody = false;
	for (const row of iterRows(input.jsonlText)) {
		const rowType = String(row.row_type ?? "").trim();
		const text = normalizeReadableText(
			normalizeText(row.text_readable) || normalizeText(row.clean_text),
		);
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
			lines.push(
				normalizeReadableText(normalizeText(row.html_readable) || normalizeText(row.html)) || text,
				"",
			);
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
	const groups = buildGroupedRegulationDocs(regulationDocs);
	writeText(resolve(targetDir, "_meta.json"), formatJsonContent(buildRegulationRootMeta(groups)));
	writeText(resolve(targetDir, "index.md"), buildPublicRegulationIndex());
	for (const group of groups) {
		const groupDir = resolve(targetDir, group.slug);
		writeText(resolve(groupDir, "_meta.json"), formatJsonContent(group.docs.map((doc) => doc.slug)));
		writeText(resolve(groupDir, "index.md"), buildRegulationGroupIndex(group));
		for (const doc of group.docs) {
			const jsonlText = await input.client.readTextObject({ key: doc.key });
			writeText(
				resolve(groupDir, `${doc.slug}.md`),
				buildPublicRegulationMarkdown({ doc, jsonlText }),
			);
		}
		removeStaleGeneratedFiles(
			groupDir,
			new Set(["_meta.json", "index.md", ...group.docs.map((doc) => `${doc.slug}.md`)]),
		);
	}
	removeStaleGeneratedFiles(
		targetDir,
		new Set(["_meta.json", "index.md", ...groups.map((group) => group.slug)]),
	);
	return regulationDocs;
}

function buildGroupedRegulationDocs(
	regulationDocs: PublicRegulationDoc[],
): Array<{
	displayName: string;
	docs: PublicRegulationDoc[];
	groupId: RegulationNavGroup;
	slug: string;
}> {
	const grouped = new Map<RegulationNavGroup, PublicRegulationDoc[]>();
	for (const doc of regulationDocs) {
		grouped.set(doc.docsNavGroup, [...(grouped.get(doc.docsNavGroup) ?? []), doc]);
	}
	return (["student", "public_service", "staff_governance"] as const)
		.map((groupId) => {
			const meta = resolveRegulationGroupMeta(groupId);
			return {
				displayName: meta.displayName,
				docs: (grouped.get(groupId) ?? []).sort((left, right) =>
					left.title.localeCompare(right.title, "zh-CN"),
				),
				groupId,
				slug: meta.slug,
			};
		})
		.filter((group) => group.docs.length > 0);
}

function buildRegulationRootMeta(
	groups: Array<{ displayName: string; slug: string }>,
): Array<
	| string
	| { label: string; name: string; type: "file" }
	| { collapsed: boolean; label: string; name: string; type: "dir" }
> {
	return [
		{ type: "file", name: "index", label: "校内规章" },
		...groups.map((group) => ({
			type: "dir" as const,
			name: group.slug,
			label: group.displayName,
			collapsed: true,
		})),
	];
}

function buildRegulationGroupIndex(input: {
	displayName: string;
	docs: PublicRegulationDoc[];
	slug: string;
}): string {
	return [
		"---",
		`title: ${jsonString(input.displayName)}`,
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
		`# ${input.displayName}`,
		"",
		`当前公开发布 ${input.docs.length} 篇文档。`,
		"",
		...input.docs.map((doc) => `- [${doc.title}](./${doc.slug})`),
		"",
	].join("\n");
}

function resolvePublicRegulationCollectionLabel(doc: Pick<PublicRegulationDoc, "collectionLabel"> & {
	docsNavGroup?: RegulationNavGroup;
}): string {
	if (doc.docsNavGroup) {
		return resolveRegulationGroupMeta(doc.docsNavGroup).displayName;
	}
	return doc.collectionLabel;
}

function isExplicitPublicRegulationDoc(jsonlText: string): boolean {
	const rows = [...iterRows(jsonlText)];
	if (rows.length === 0) {
		return false;
	}
	for (const row of rows) {
		const visibilityLevel = normalizeText(row.visibility_level);
		if (visibilityLevel && visibilityLevel !== "public") {
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

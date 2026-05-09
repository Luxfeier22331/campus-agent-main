import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRegulationConsumptionManifest } from "../scripts/regulation-consumption";
import { syncRealDocs } from "../scripts/sync-real-docs";
import { buildHandbookDocKey, loadHandbookDocs } from "../scripts/sync-real-docs/handbook";
import { discoverPublicRegulationDocs } from "../scripts/sync-real-docs/regulations";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

const PUBLIC_SERVICE_DOC_ID = "official_web_regulation:b23aa5f14642eb92";
const PUBLIC_SERVICE_TITLE = "中央民族大学校园网接入管理办法";
const STAFF_GOVERNANCE_DOC_ID = "official_web_regulation:252e764624d17af1";
const STAFF_GOVERNANCE_TITLE = "中央民族大学学术委员会章程";
const STUDENT_DOC_ID = "official_web_regulation:e4a8804f56032cab";
const STUDENT_TITLE = "本科生转专业实施细则";

function createDocsRoot(): string {
	const targetRoot = mkdtempSync(join(tmpdir(), "public-docs-real-regulations-"));
	temporaryDirectories.push(targetRoot);
	return targetRoot;
}

function buildDocumentUnitsJsonl(input: {
	docId: string;
	title: string;
	sourcePdf: string;
}): string {
	return [
		{
			clean_text: input.title,
			doc_id: input.docId,
			entitlement_groups: [],
			metadata: { title: input.title },
			page_end: 1,
			page_start: 1,
			row_type: "heading",
			source_pdf: input.sourcePdf,
			version_id: `ver:${input.docId}`,
			visibility_level: "public",
		},
		{
			clean_text: "正文示例",
			doc_id: input.docId,
			entitlement_groups: [],
			page_end: 2,
			page_start: 2,
			row_type: "paragraph",
			source_pdf: input.sourcePdf,
			version_id: `ver:${input.docId}`,
			visibility_level: "public",
		},
	]
		.map((row) => JSON.stringify(row))
		.join("\n");
}

describe("real docs regulation sync", () => {
	it("groups public regulation docs by student, public-service, and staff-governance", async () => {
		const docsRoot = createDocsRoot();
		const objectStore = buildCompletePublicRegulationObjectStore();

		const docs = await discoverPublicRegulationDocs(objectStore);
		await syncRealDocs({ client: objectStore, docsRoot });

		expect(docs).toHaveLength(23);
		expect(docs.map((doc) => [doc.documentId, doc.docsNavGroup])).toEqual(
			expect.arrayContaining([
				[PUBLIC_SERVICE_DOC_ID, "public_service"],
				[STAFF_GOVERNANCE_DOC_ID, "staff_governance"],
				[STUDENT_DOC_ID, "student"],
			]),
		);

		const publicServiceDoc = docs.find((doc) => doc.documentId === PUBLIC_SERVICE_DOC_ID);
		const staffGovernanceDoc = docs.find((doc) => doc.documentId === STAFF_GOVERNANCE_DOC_ID);
		const studentDoc = docs.find((doc) => doc.documentId === STUDENT_DOC_ID);
		expect(publicServiceDoc).toBeDefined();
		expect(staffGovernanceDoc).toBeDefined();
		expect(studentDoc).toBeDefined();
		expect(staffGovernanceDoc?.title).toBe(STAFF_GOVERNANCE_TITLE);
		expect(studentDoc?.title).toBe(STUDENT_TITLE);

		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/_meta.json"), "utf8"),
		).toContain('"type": "section-header"');
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/_meta.json"), "utf8"),
		).toContain("学生规章");
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/_meta.json"), "utf8"),
		).toContain("校园服务制度");
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/_meta.json"), "utf8"),
		).toContain("教职工与校级治理");
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/index.md"), "utf8"),
		).toContain("## 学生规章");
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/index.md"), "utf8"),
		).toContain("## 校园服务制度");
		expect(
			readFileSync(join(docsRoot, "docs/regulations/institutional_rules/index.md"), "utf8"),
		).toContain("## 教职工与校级治理");
		expect(
			existsSync(
				join(docsRoot, "docs/regulations/institutional_rules", `${publicServiceDoc?.slug}.mdx`),
			),
		).toBe(true);
		expect(
			existsSync(
				join(docsRoot, "docs/regulations/institutional_rules", `${staffGovernanceDoc?.slug}.mdx`),
			),
		).toBe(true);
		expect(
			existsSync(join(docsRoot, "docs/regulations/institutional_rules", `${studentDoc?.slug}.mdx`)),
		).toBe(true);
		expect(
			readFileSync(
				join(docsRoot, "docs/regulations/institutional_rules", `${publicServiceDoc?.slug}.mdx`),
				"utf8",
			),
		).toContain("来源：校园服务制度");
		expect(
			readFileSync(
				join(docsRoot, "docs/regulations/institutional_rules", `${staffGovernanceDoc?.slug}.mdx`),
				"utf8",
			),
		).toContain("来源：教职工与校级治理");
		expect(
			readFileSync(
				join(docsRoot, "docs/regulations/institutional_rules", `${studentDoc?.slug}.mdx`),
				"utf8",
			),
		).toContain("来源：学生规章");
	});

	it("fails closed when the public regulation consumption manifest is not backed by canonical documents", async () => {
		const objectStore = new FakeObjectStore(
			new Map([
				[
					"regulations/documents/institutional_rules/campus-net/source-faithful/current/document-units.jsonl",
					buildDocumentUnitsJsonl({
						docId: PUBLIC_SERVICE_DOC_ID,
						title: PUBLIC_SERVICE_TITLE,
						sourcePdf: "campus-net.pdf",
					}),
				],
			]),
		);

		await expect(discoverPublicRegulationDocs(objectStore)).rejects.toThrow(
			/public regulation consumption manifest has 22 canonical document gaps/u,
		);
	});

	it("fails closed when a manifest-backed public regulation doc has duplicate canonical objects", async () => {
		const objectStore = buildCompletePublicRegulationObjectStore();
		await objectStore.writeTextObject({
			key: "regulations/documents/institutional_rules/stale-plan-title/current/document-units.jsonl",
			text: buildDocumentUnitsJsonl({
				docId: "official_web_regulation:12ce0e9b47598c5d",
				title: "中央民族大学章程",
				sourcePdf: "stale-plan-title.pdf",
			}),
		});

		await expect(discoverPublicRegulationDocs(objectStore)).rejects.toThrow(
			/duplicate canonical public regulation documents for official_web_regulation:12ce0e9b47598c5d/u,
		);
	});
});

function buildCompletePublicRegulationObjectStore(): FakeObjectStore {
	const objects = new Map<string, string>();
	for (const handbookDoc of loadHandbookDocs()) {
		objects.set(
			buildHandbookDocKey(handbookDoc),
			[
				"---",
				`title: '${handbookDoc.title}'`,
				`doc_id: ${handbookDoc.documentId}`,
				"version_id: sha256:handbook-test-version",
				"source_doc: '学生手册_2018.pdf'",
				"page_start: 1",
				"page_end: 2",
				"---",
				"",
				"正文示例。",
			].join("\n"),
		);
	}
	objects.set(
		"curriculum/documents/curriculum_plan/computer-science/source-faithful/2022/document-units.jsonl",
		[
			'{"doc_id":"curriculum:计算机类本科人才培养方案","version_id":"sha256:curriculum-version","source_pdf":"curriculum-plan-2022.pdf","page_start":1,"page_end":2,"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"doc_id":"curriculum:计算机类本科人才培养方案","version_id":"sha256:curriculum-version","source_pdf":"curriculum-plan-2022.pdf","page_start":2,"page_end":2,"row_type":"paragraph","clean_text":"正文示例"}',
		].join("\n"),
	);
	for (const entry of loadRegulationConsumptionManifest().documents) {
		const collection = entry.canonical_scope.split("/").at(-1);
		if (!collection) {
			throw new Error(`invalid canonical scope in test fixture: ${entry.canonical_scope}`);
		}
		const key = `regulations/documents/${collection}/${entry.document_id.replace(/[^a-z0-9]+/giu, "-")}/current/document-units.jsonl`;
		objects.set(
			key,
			buildDocumentUnitsJsonl({
				docId: entry.document_id,
				title: entry.title,
				sourcePdf: `${entry.document_id}.pdf`,
			}),
		);
	}
	return new FakeObjectStore(objects);
}

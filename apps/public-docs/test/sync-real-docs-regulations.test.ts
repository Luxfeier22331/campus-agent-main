import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	discoverPublicRegulationDocs,
	syncPublicRegulationDocs,
} from "../scripts/sync-real-docs/regulations";
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

function buildDocumentUnitsJsonl(input: { docId: string; title: string; sourcePdf: string }): string {
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
				[
					"regulations/documents/institutional_rules/academic-committee/source-faithful/current/document-units.jsonl",
					buildDocumentUnitsJsonl({
						docId: STAFF_GOVERNANCE_DOC_ID,
						title: STAFF_GOVERNANCE_TITLE,
						sourcePdf: "academic-committee.pdf",
					}),
				],
				[
					"regulations/documents/student_rules/transfer-major/source-faithful/current/document-units.jsonl",
					buildDocumentUnitsJsonl({
						docId: STUDENT_DOC_ID,
						title: STUDENT_TITLE,
						sourcePdf: "transfer-major.pdf",
					}),
				],
			]),
		);

		const docs = await discoverPublicRegulationDocs(objectStore);
		await syncPublicRegulationDocs({
			client: objectStore,
			docsRoot,
			regulationDocs: docs,
		});

		expect(docs).toHaveLength(3);
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

		expect(readFileSync(join(docsRoot, "campus-regulations", "_meta.json"), "utf8")).toContain(
			'"name": "student"',
		);
		expect(readFileSync(join(docsRoot, "campus-regulations", "_meta.json"), "utf8")).toContain(
			'"name": "public-service"',
		);
		expect(readFileSync(join(docsRoot, "campus-regulations", "_meta.json"), "utf8")).toContain(
			'"name": "staff-governance"',
		);
		expect(readFileSync(join(docsRoot, "campus-regulations", "index.md"), "utf8")).toContain(
			"[学生规章](./student/)",
		);
		expect(readFileSync(join(docsRoot, "campus-regulations", "index.md"), "utf8")).toContain(
			"[校园服务制度](./public-service/)",
		);
		expect(readFileSync(join(docsRoot, "campus-regulations", "index.md"), "utf8")).toContain(
			"[教职工与校级治理](./staff-governance/)",
		);
		expect(
			existsSync(
				join(docsRoot, "campus-regulations", "public-service", `${publicServiceDoc?.slug}.md`),
			),
		).toBe(true);
		expect(
			existsSync(
				join(
					docsRoot,
					"campus-regulations",
					"staff-governance",
					`${staffGovernanceDoc?.slug}.md`,
				),
			),
		).toBe(true);
		expect(
			existsSync(join(docsRoot, "campus-regulations", "student", `${studentDoc?.slug}.md`)),
		).toBe(true);
		expect(
			readFileSync(
				join(docsRoot, "campus-regulations", "public-service", `${publicServiceDoc?.slug}.md`),
				"utf8",
			),
		).toContain("来源：校园服务制度");
		expect(
			readFileSync(
				join(
					docsRoot,
					"campus-regulations",
					"staff-governance",
					`${staffGovernanceDoc?.slug}.md`,
				),
				"utf8",
			),
		).toContain("来源：教职工与校级治理");
		expect(
			readFileSync(
				join(docsRoot, "campus-regulations", "student", `${studentDoc?.slug}.md`),
				"utf8",
			),
		).toContain("来源：学生规章");
	});
});

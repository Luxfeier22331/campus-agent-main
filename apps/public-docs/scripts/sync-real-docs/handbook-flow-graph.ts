import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCourseMapDataImportName, buildCourseMapDataModule } from "./course-map";
import {
	asArray,
	asRecord,
	HANDBOOK_SOURCE_PROJECTIONS_PATH,
	HANDBOOK_YEAR,
	type HandbookFlowGraphDoc,
	jsonString,
	removeStaleGeneratedFiles,
	SOURCE_BUCKET,
	writeText,
} from "./shared";
import type { ObjectStoreClient } from "./storage";

const FLOW_GRAPH_FILENAME = "flow-graph.json";
const FLOW_GRAPH_SCHEMA_VERSION = "handbook_service_navigation_projection_v1";
const FLOW_GRAPH_DOC_COMPONENT_IMPORT_PATH = "../.components/HandbookFlowGraphSection";
const HANDBOOK_FLOW_GRAPH_DOC_SLUG_OVERRIDES = new Map<string, string>([
	["handbook_navigation_service_catalog", "central-minzu-student-dormitory-management-workflow"],
]);

export async function syncHandbookFlowGraphArtifacts(input: {
	client: ObjectStoreClient;
	docsRoot: string;
}): Promise<HandbookFlowGraphDoc[]> {
	const generatedDir = resolve(input.docsRoot, ".generated/handbook-flow-graphs");
	const targetDir = resolve(input.docsRoot, "student-handbook");
	const generatedDocs: HandbookFlowGraphDoc[] = [];
	const expectedDataFiles = new Set<string>();

	for (const projection of loadHandbookFlowGraphProjectionConfigs()) {
		const projectionName = requireText(projection, "projection_name");
		const flowGraphKey = await findHandbookFlowGraphObjectKey(input.client, projectionName);
		if (!flowGraphKey) {
			continue;
		}
		const rawBytes = await input.client.readOptionalBytesObject({
			bucket: SOURCE_BUCKET,
			key: flowGraphKey,
		});
		if (!rawBytes) {
			continue;
		}
		const payload = JSON.parse(new TextDecoder().decode(rawBytes)) as Record<string, unknown>;
		validateHandbookFlowGraphPayload(payload, projection);
		const title = requireText(projection, "target_title");
		const slug = buildHandbookFlowGraphDocSlug(projection);
		const dataModuleName = `${slug}.data.ts`;
		const dataImportName = buildCourseMapDataImportName(slug);
		const dataImportPath = `../.generated/handbook-flow-graphs/${slug}.data`;
		writeText(
			resolve(generatedDir, dataModuleName),
			buildCourseMapDataModule(buildHandbookFlowGraphDataPayload(payload), {
				biomeFilePath: `apps/public-docs/docs/.generated/handbook-flow-graphs/${dataModuleName}`,
			}),
		);
		writeText(
			resolve(targetDir, `${slug}.mdx`),
			buildHandbookFlowGraphMarkdown({ dataImportName, dataImportPath, title }),
		);
		expectedDataFiles.add(dataModuleName);
		generatedDocs.push({ filename: `${slug}.mdx`, slug, title });
	}
	removeStaleGeneratedFiles(generatedDir, expectedDataFiles);
	return generatedDocs;
}

function loadHandbookFlowGraphProjectionConfigs(): Record<string, unknown>[] {
	const payload = JSON.parse(readFileSync(HANDBOOK_SOURCE_PROJECTIONS_PATH, "utf-8"));
	return asArray(asRecord(payload)?.projections)
		.map(asRecord)
		.filter(isRecord)
		.filter(
			(projection) =>
				projection.attachment_role === "service_navigation_document" &&
				projection.target_collection === "service_catalog",
		);
}

async function findHandbookFlowGraphObjectKey(
	client: ObjectStoreClient,
	projectionName: string,
): Promise<string | undefined> {
	const suffix = `/projection/${projectionName}/${FLOW_GRAPH_FILENAME}`;
	for (const prefix of [
		`official_pdf/student-handbook/${HANDBOOK_YEAR}/`,
		"official_pdf/student-handbook/",
	]) {
		const candidates = (await client.listObjectKeys({ bucket: SOURCE_BUCKET, prefix })).filter(
			(key) => key.endsWith(suffix),
		);
		if (candidates.length > 0) {
			return candidates.sort().at(-1);
		}
	}
	return;
}

function validateHandbookFlowGraphPayload(
	payload: Record<string, unknown>,
	projection: Record<string, unknown>,
): void {
	const projectionName = requireText(projection, "projection_name");
	const targetTitle = requireText(projection, "target_title");
	const sourcePageStart = requireInt(projection, "source_page_start");
	const sourcePageEnd = requireInt(projection, "source_page_end");
	if (payload.schema_version !== FLOW_GRAPH_SCHEMA_VERSION) {
		throw new Error(
			`${projectionName} flow graph schema mismatch: ${String(payload.schema_version)}`,
		);
	}
	if (payload.projection_name !== projectionName) {
		throw new Error(
			`${projectionName} flow graph projection mismatch: ${String(payload.projection_name)}`,
		);
	}
	if (payload.target_title !== targetTitle) {
		throw new Error(
			`${projectionName} flow graph target_title mismatch: ${String(payload.target_title)}`,
		);
	}
	if (requireInt(payload, "source_page_start") !== sourcePageStart) {
		throw new Error(`${projectionName} flow graph source_page_start mismatch`);
	}
	if (requireInt(payload, "source_page_end") !== sourcePageEnd) {
		throw new Error(`${projectionName} flow graph source_page_end mismatch`);
	}
	const flowGraph = requireMapping(payload, "flow_graph");
	if (flowGraph.document_title !== targetTitle) {
		throw new Error(`${projectionName} flow_graph document_title mismatch`);
	}
	if (iterBodyBearingFlowSteps(flowGraph).length === 0) {
		throw new Error(`${projectionName} flow graph has no body-bearing steps`);
	}
}

function buildHandbookFlowGraphDocSlug(projection: Record<string, unknown>): string {
	const projectionName = requireText(projection, "projection_name");
	const override = HANDBOOK_FLOW_GRAPH_DOC_SLUG_OVERRIDES.get(projectionName);
	if (override) {
		return override;
	}
	const title = requireText(projection, "target_title");
	return title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || projectionName;
}

function buildHandbookFlowGraphDataPayload(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const flowGraph = requireMapping(payload, "flow_graph");
	const manualReviewRequired = Boolean(flowGraph.global_manual_review_required);
	const pageFindings: Record<string, unknown>[] = [];
	for (const page of asArray(flowGraph.page_findings).map(asRecord).filter(isRecord)) {
		const flows = buildHandbookFlowPayloads(page);
		if (flows.length === 0) {
			continue;
		}
		pageFindings.push({
			sourcePage: requireInt(page, "source_page"),
			pageHeading: String(page.page_heading ?? "").trim(),
			flows,
		});
	}
	return {
		title: requireText(payload, "target_title"),
		sourceHandbookSection: requireText(payload, "source_handbook_section"),
		sourcePageStart: requireInt(payload, "source_page_start"),
		sourcePageEnd: requireInt(payload, "source_page_end"),
		manualReviewRequired,
		extractionStatus: manualReviewRequired ? "needs_review" : "ready",
		pageFindings,
	};
}

function buildHandbookFlowPayloads(page: Record<string, unknown>): Record<string, unknown>[] {
	const flows: Record<string, unknown>[] = [];
	for (const flow of asArray(page.flows).map(asRecord).filter(isRecord)) {
		const steps = buildHandbookFlowStepPayloads(flow);
		if (steps.length === 0) {
			continue;
		}
		flows.push({
			flowHeading: String(flow.flow_heading ?? "未命名流程").trim(),
			audienceScope: String(flow.audience_scope ?? "").trim(),
			steps,
			manualReviewNotes: asArray(flow.manual_review_notes)
				.map((note) => String(note).trim())
				.filter(Boolean),
		});
	}
	return flows;
}

function buildHandbookFlowStepPayloads(flow: Record<string, unknown>): Record<string, unknown>[] {
	const steps: Record<string, unknown>[] = [];
	for (const step of asArray(flow.steps).map(asRecord).filter(isRecord)) {
		const stepText = String(step.step_text ?? "").trim();
		if (!stepText) {
			continue;
		}
		steps.push({
			stepId: String(step.step_id ?? "").trim(),
			stepText,
			nextStepIds: asArray(step.next_step_ids)
				.map((stepId) => String(stepId).trim())
				.filter(Boolean),
		});
	}
	return steps;
}

function buildHandbookFlowGraphMarkdown(input: {
	title: string;
	dataImportName: string;
	dataImportPath: string;
}): string {
	return [
		"---",
		`title: ${jsonString(input.title)}`,
		"description: 学生手册中服务流程图的结构化阅读页。",
		"footer: false",
		"---",
		"",
		`import HandbookFlowGraphSection from "${FLOW_GRAPH_DOC_COMPONENT_IMPORT_PATH}";`,
		`import ${input.dataImportName} from "${input.dataImportPath}";`,
		"",
		`<HandbookFlowGraphSection data={${input.dataImportName}} />`,
		"",
	].join("\n");
}

function iterBodyBearingFlowSteps(flowGraph: Record<string, unknown>): Record<string, unknown>[] {
	const steps: Record<string, unknown>[] = [];
	for (const page of asArray(flowGraph.page_findings).map(asRecord).filter(isRecord)) {
		for (const flow of asArray(page.flows).map(asRecord).filter(isRecord)) {
			for (const step of asArray(flow.steps).map(asRecord).filter(isRecord)) {
				if (String(step.step_text ?? "").trim()) {
					steps.push(step);
				}
			}
		}
	}
	return steps;
}

function requireMapping(
	payload: Record<string, unknown>,
	fieldName: string,
): Record<string, unknown> {
	const value = asRecord(payload[fieldName]);
	if (!value) {
		throw new Error(`${fieldName} object is required`);
	}
	return value;
}

function requireText(payload: Record<string, unknown>, fieldName: string): string {
	const value = String(payload[fieldName] ?? "").trim();
	if (!value) {
		throw new Error(`${fieldName} is required`);
	}
	return value;
}

function requireInt(payload: Record<string, unknown>, fieldName: string): number {
	const value = payload[fieldName];
	if (typeof value === "boolean") {
		throw new Error(`${fieldName} must be an integer`);
	}
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${fieldName} must be an integer`);
	}
	return parsed;
}

function isRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
	return value !== undefined;
}

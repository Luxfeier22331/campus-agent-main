import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runOfficialWebNextCapture } from "./capture.ts";
import { FilesystemOfficialWebNextArtifactStore } from "./filesystem-artifact-store.ts";
import { uploadOfficialWebNextReferenceArtifacts } from "./reference-artifacts.ts";
import type { OfficialWebNextReferencePipelineResult } from "./reference-pipeline.ts";
import { buildOfficialWebNextReferencePipeline } from "./reference-pipeline.ts";
import type {
	OfficialWebNextCaptureInput,
	OfficialWebNextCaptureResult,
	OfficialWebNextContentBlock,
	OfficialWebNextCrawlPolicy,
	OfficialWebNextDiscoveryMethod,
	OfficialWebNextRenderMode,
	OfficialWebNextSourceTruthBundle,
	OfficialWebNextWorksetItem,
	StoredArtifactRef,
} from "./types.ts";

export interface OfficialWebNextLocalHarnessInput {
	artifactRootDir: string;
	crawlPolicy?: Partial<OfficialWebNextCrawlPolicy>;
	limits?: OfficialWebNextCaptureInput["limits"];
	releaseId: string;
	runId: string;
	siteId: string;
	worksetPath: string;
}

export interface OfficialWebNextLocalHarnessResult {
	capture: OfficialWebNextCaptureResult;
	reference: OfficialWebNextReferencePipelineResult;
	referenceArtifactRefs: StoredArtifactRef[];
}

export async function runOfficialWebNextLocalHarness(
	input: OfficialWebNextLocalHarnessInput,
): Promise<OfficialWebNextLocalHarnessResult> {
	const artifactStore = new FilesystemOfficialWebNextArtifactStore(input.artifactRootDir);
	const workset = await readWorkset(input.worksetPath);
	const capture = await runOfficialWebNextCapture({
		artifactStore,
		crawlPolicy: input.crawlPolicy,
		limits: input.limits,
		runId: input.runId,
		siteId: input.siteId,
		workset,
	});
	const bundle = await readJsonFile<OfficialWebNextSourceTruthBundle>(
		join(input.artifactRootDir, capture.sourceTruthBundleRef.objectKey),
	);
	const blocksByObjectKey = new Map<string, OfficialWebNextContentBlock[]>();
	for (const page of bundle.pages) {
		blocksByObjectKey.set(
			page.contentBlocksObjectKey,
			await readJsonLinesFile<OfficialWebNextContentBlock>(
				join(input.artifactRootDir, page.contentBlocksObjectKey),
			),
		);
	}
	const reference = buildOfficialWebNextReferencePipeline({
		blocksByObjectKey,
		bundle,
		releaseId: input.releaseId,
	});
	const referenceArtifactRefs = await uploadOfficialWebNextReferenceArtifacts({
		artifactStore,
		reference,
	});
	return {
		capture,
		reference,
		referenceArtifactRefs,
	};
}

async function readWorkset(path: string): Promise<OfficialWebNextWorksetItem[]> {
	const value = await readJsonFile<unknown>(path);
	if (!Array.isArray(value)) {
		throw new Error("official-web-next workset file must contain a JSON array");
	}
	return value.map((item, index) => parseWorksetItem(item, index));
}

function parseWorksetItem(value: unknown, index: number): OfficialWebNextWorksetItem {
	if (!isRecord(value)) {
		throw new Error(`official-web-next workset item ${index} must be an object`);
	}
	const url = readString(value, "url", index);
	const host = readString(value, "host", index);
	const discoveryMethod = readString(value, "discoveryMethod", index);
	if (!isDiscoveryMethod(discoveryMethod)) {
		throw new Error(`official-web-next workset item ${index} has invalid discoveryMethod`);
	}
	const renderMode = value.renderMode;
	if (!isRenderMode(renderMode)) {
		throw new Error(`official-web-next workset item ${index} has invalid renderMode`);
	}
	return {
		url,
		host,
		discoveryMethod,
		renderMode,
	};
}

function isDiscoveryMethod(value: string): value is OfficialWebNextDiscoveryMethod {
	return value === "seed" || value === "sitemap" || value === "manual" || value === "known_url";
}

function isRenderMode(value: unknown): value is OfficialWebNextRenderMode | undefined {
	return value === undefined || value === "html" || value === "browser";
}

function readString(value: Record<string, unknown>, key: string, index: number): string {
	const field = value[key];
	if (typeof field !== "string" || field.trim() === "") {
		throw new Error(`official-web-next workset item ${index} requires string ${key}`);
	}
	return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonFile<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonLinesFile<T>(path: string): Promise<T[]> {
	const text = await readFile(path, "utf8");
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as T);
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { OfficialWebArtifactStore } from "./artifact-store.ts";
import {
	type buildOfficialWebCrawlRunRecord,
	type buildOfficialWebHostSummaryDocument,
	buildOfficialWebRunArtifactKey,
	buildOfficialWebSourceTruthBundle,
	OFFICIAL_WEB_DYNAMIC_SHELL_DISCOVERY_AUDIT_ARTIFACT,
	OFFICIAL_WEB_PAGE_OBSERVATIONS_ARTIFACT,
	OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
	OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
	type OfficialWebFailureRecord,
	type OfficialWebKnownRunArtifactName,
	type OfficialWebPageObservationRecord,
	type OfficialWebQualityAuditDocument,
	type OfficialWebRunArtifactRef,
	type OfficialWebSourceTruthBundle,
	type OfficialWebUrlResultRecord,
	resolveOfficialWebRunArtifactType,
} from "./core/index.ts";
import type { OfficialWebDynamicShellDiscoveryAudit } from "./dynamic-shell-discovery.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export interface RunArtifactDescriptor {
	artifactName: OfficialWebKnownRunArtifactName;
	contentType: string;
	data: Uint8Array;
	recordCount?: number;
}

export function buildRunArtifacts(payload: {
	crawlRun: ReturnType<typeof buildOfficialWebCrawlRunRecord>;
	hostSummary: ReturnType<typeof buildOfficialWebHostSummaryDocument>;
	sourceTruthBundle: OfficialWebSourceTruthBundle;
	qualityAudit: OfficialWebQualityAuditDocument;
	pageObservations: OfficialWebPageObservationRecord[];
	urlResults: OfficialWebUrlResultRecord[];
	failures: OfficialWebFailureRecord[];
	dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[];
}): RunArtifactDescriptor[] {
	return [
		{
			artifactName: "crawl-run.json",
			contentType: "application/json",
			data: encodeJson(payload.crawlRun),
			recordCount: 1,
		},
		{
			artifactName: "host-summary.json",
			contentType: "application/json",
			data: encodeJson(payload.hostSummary),
			recordCount: payload.hostSummary.hosts.length,
		},
		{
			artifactName: "url-results.jsonl",
			contentType: "application/x-ndjson",
			data: encodeText(toJsonLines(payload.urlResults)),
			recordCount: payload.urlResults.length,
		},
		{
			artifactName: "failures.jsonl",
			contentType: "application/x-ndjson",
			data: encodeText(toJsonLines(payload.failures)),
			recordCount: payload.failures.length,
		},
		{
			artifactName: OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
			contentType: "application/json",
			data: encodeJson(payload.sourceTruthBundle),
			recordCount: payload.sourceTruthBundle.pages.length,
		},
		{
			artifactName: OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
			contentType: "application/json",
			data: encodeJson(payload.qualityAudit),
			recordCount: payload.qualityAudit.pages.length,
		},
		{
			artifactName: OFFICIAL_WEB_PAGE_OBSERVATIONS_ARTIFACT,
			contentType: "application/x-ndjson",
			data: encodeText(toJsonLines(payload.pageObservations)),
			recordCount: payload.pageObservations.length,
		},
		...buildDynamicShellDiscoveryAuditArtifacts(payload.dynamicShellDiscoveryAudits),
	];
}

export function writeCollectorArtifacts(
	outputDir: string,
	payload: {
		runArtifacts: RunArtifactDescriptor[];
		pages: CollectedPageArtifact[];
	},
): Record<string, string> {
	const artifactPaths: Record<string, string> = {};

	for (const runArtifact of payload.runArtifacts) {
		const artifactPath = resolve(outputDir, runArtifact.artifactName);
		mkdirSync(dirname(artifactPath), { recursive: true });
		writeFileSync(artifactPath, runArtifact.data);
		artifactPaths[runArtifact.artifactName] = artifactPath;
	}

	for (const page of payload.pages) {
		for (const file of page.files) {
			const localPath = resolve(
				outputDir,
				"source-assets",
				page.rawAssetId,
				page.rawVersionId,
				file.relativePath,
			);
			mkdirSync(dirname(localPath), { recursive: true });
			writeFileSync(localPath, file.data);
		}
	}

	return artifactPaths;
}

export async function uploadCollectorArtifacts(input: {
	siteId: string;
	crawlRunId: string;
	artifactStore: OfficialWebArtifactStore;
	runArtifacts: RunArtifactDescriptor[];
	pages: CollectedPageArtifact[];
}): Promise<{ uploadedArtifacts: OfficialWebRunArtifactRef[]; artifactUploadCount: number }> {
	const uploadedArtifacts: OfficialWebRunArtifactRef[] = [];
	let artifactUploadCount = 0;

	for (const runArtifact of input.runArtifacts) {
		const objectKey = buildOfficialWebRunArtifactKey({
			siteId: input.siteId,
			crawlRunId: input.crawlRunId,
			artifactName: runArtifact.artifactName,
		});
		const stored = await input.artifactStore.putObject({
			objectKey,
			data: runArtifact.data,
			contentType: runArtifact.contentType,
			recordCount: runArtifact.recordCount,
		});
		artifactUploadCount += 1;
		uploadedArtifacts.push({
			artifactType: resolveOfficialWebRunArtifactType(runArtifact.artifactName),
			objectKey: stored.objectKey,
			contentSha256: stored.contentSha256,
			byteSize: stored.byteSize,
			recordCount: stored.recordCount,
		});
	}

	for (const page of input.pages) {
		for (const file of page.files) {
			await input.artifactStore.putObject({
				objectKey: file.objectKey,
				data: file.data,
				contentType: file.contentType,
				recordCount: file.recordCount,
			});
			artifactUploadCount += 1;
		}
	}

	return {
		uploadedArtifacts,
		artifactUploadCount,
	};
}

export function buildRunSourceTruthBundle(
	siteId: string,
	crawlRunId: string,
	pages: CollectedPageArtifact[],
	options: {
		collectionMode?: "target-workset";
	} = {},
): OfficialWebSourceTruthBundle {
	return buildOfficialWebSourceTruthBundle({
		siteId,
		crawlRunId,
		collectionMode: options.collectionMode,
		pages: pages.map((page) => ({
			rawAssetId: page.rawAssetId,
			rawVersionId: page.rawVersionId,
			normalizedCanonicalUrl: page.pageManifest.normalizedCanonicalUrl,
			pageFamily: page.pageManifest.pageFamily,
			sourcePackId: page.pageManifest.sourcePackId,
			sourcePackEntryId: page.pageManifest.sourcePackEntryId,
			compositionGroup: page.pageManifest.compositionGroup,
			compositionRole: page.pageManifest.compositionRole,
			pageManifestObjectKey: findPageFileObjectKey(page, "source-truth/page-manifest.json"),
			contentBlocksObjectKey: findPageFileObjectKey(page, "source-truth/content-blocks.jsonl"),
			providerExtractionObjectKey: findPageFileObjectKey(
				page,
				"provider/cheerio-basic/page-extraction.json",
			),
			discoveredLinksObjectKey: findPageFileObjectKey(
				page,
				"provider/cheerio-basic/discovered-links.jsonl",
			),
			responseHtmlObjectKey: findPageFileObjectKey(page, "capture/response.html"),
			responseBodyHash: page.pageManifest.responseBodyHash,
			blockCount: page.contentBlocks.length,
			consumerMatches: page.pageManifest.consumerMatches ?? [],
			consumerRetentionDecision: page.pageManifest.consumerRetentionDecision,
			consumerRejectionReason: page.pageManifest.consumerRejectionReason ?? null,
			targetJobId: page.pageManifest.targetJobId,
			targetCandidateId: page.pageManifest.targetCandidateId,
			targetDeclarationVersion: page.pageManifest.targetDeclarationVersion,
			targetMatches: page.pageManifest.targetMatches,
			materializationPolicy: page.pageManifest.materializationPolicy,
			selectedWriteTarget: page.pageManifest.selectedWriteTarget,
			reviewPolicy: page.pageManifest.reviewPolicy,
		})),
	});
}

export function dedupeCollectedPages(pages: CollectedPageArtifact[]): CollectedPageArtifact[] {
	const byIdentity = new Map<string, CollectedPageArtifact>();

	for (const page of pages) {
		byIdentity.set(buildCollectedPageIdentityKey(page), page);
	}

	return [...byIdentity.values()];
}

export function dedupePageObservations(
	observations: OfficialWebPageObservationRecord[],
): OfficialWebPageObservationRecord[] {
	const byIdentity = new Map<string, OfficialWebPageObservationRecord>();

	for (const observation of observations) {
		byIdentity.set(buildPageObservationIdentityKey(observation), observation);
	}

	return [...byIdentity.values()];
}

function buildDynamicShellDiscoveryAuditArtifacts(
	audits: OfficialWebDynamicShellDiscoveryAudit[],
): RunArtifactDescriptor[] {
	if (audits.length === 0) {
		return [];
	}

	return [
		{
			artifactName: OFFICIAL_WEB_DYNAMIC_SHELL_DISCOVERY_AUDIT_ARTIFACT,
			contentType: "application/x-ndjson",
			data: encodeText(toJsonLines(audits)),
			recordCount: audits.length,
		},
	];
}

function buildCollectedPageIdentityKey(page: CollectedPageArtifact): string {
	return `${page.rawAssetId}::${page.rawVersionId}`;
}

function buildPageObservationIdentityKey(observation: OfficialWebPageObservationRecord): string {
	return [
		observation.normalizedCanonicalUrl,
		observation.disposition,
		observation.rawAssetId ?? "",
		observation.rawVersionId ?? "",
		observation.responseBodyHash ?? "",
		observation.mainContentHash ?? "",
		observation.httpStatus == null ? "" : String(observation.httpStatus),
	].join("::");
}

function findPageFileObjectKey(page: CollectedPageArtifact, relativePath: string): string {
	const file = page.files.find((item) => item.relativePath === relativePath);
	if (!file) {
		throw new Error(
			`missing page artifact ${relativePath} for ${page.rawAssetId}/${page.rawVersionId}`,
		);
	}
	return file.objectKey;
}

function toJsonLines(records: readonly object[]): string {
	if (records.length === 0) {
		return "";
	}
	return `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function encodeJson(value: object): Uint8Array {
	return encodeText(JSON.stringify(value, null, 2));
}

function encodeText(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

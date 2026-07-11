import type {
	OfficialWebNextArtifactStore,
	OfficialWebNextBundlePage,
	OfficialWebNextContentBlock,
	OfficialWebNextDiscoveredLink,
	OfficialWebNextPageManifest,
	OfficialWebNextSourceTruthBundle,
	OfficialWebNextValidationReport,
	StoredArtifactRef,
} from "./types.ts";

const textEncoder = new TextEncoder();

export interface UploadedOfficialWebNextPage {
	refs: StoredArtifactRef[];
	bundlePage: OfficialWebNextBundlePage;
}

export async function uploadPageArtifacts(input: {
	artifactStore: OfficialWebNextArtifactStore;
	contentBlocks: OfficialWebNextContentBlock[];
	discoveredLinks: OfficialWebNextDiscoveredLink[];
	manifest: OfficialWebNextPageManifest;
	responseBody: string;
	responseHeaders: Record<string, string | string[] | undefined>;
	runId: string;
	siteId: string;
}): Promise<UploadedOfficialWebNextPage> {
	const prefix = pageArtifactPrefix({
		rawAssetId: input.manifest.rawAssetId,
		rawVersionId: input.manifest.rawVersionId,
		siteId: input.siteId,
	});
	const artifacts = [
		jsonArtifact(`${prefix}/capture/response-headers.json`, input.responseHeaders),
		jsonArtifact(`${prefix}/capture/fetch-metadata.json`, {
			schemaVersion: "official_web_next_fetch_metadata.v1",
			requestedUrl: input.manifest.requestedUrl,
			finalUrl: input.manifest.finalUrl,
			normalizedCanonicalUrl: input.manifest.normalizedCanonicalUrl,
			fetchedAt: input.manifest.fetchedAt,
			httpStatus: input.manifest.httpStatus,
			contentType: input.manifest.contentType,
			headers: input.responseHeaders,
		}),
		textArtifact(`${prefix}/capture/response.html`, "text/html; charset=utf-8", input.responseBody),
		jsonArtifact(`${prefix}/provider/cheerio/page-extraction.json`, {
			schemaVersion: "official_web_next_provider_page_extraction.v1",
			rawAssetId: input.manifest.rawAssetId,
			rawVersionId: input.manifest.rawVersionId,
			parserName: "cheerio",
			pageTitleNormalized: input.manifest.pageTitleNormalized,
			blockCount: input.contentBlocks.length,
			discoveredLinkCount: input.discoveredLinks.length,
		}),
		ndjsonArtifact(`${prefix}/provider/cheerio/discovered-links.jsonl`, input.discoveredLinks),
		jsonArtifact(`${prefix}/source-truth/page-manifest.json`, input.manifest),
		ndjsonArtifact(`${prefix}/source-truth/content-blocks.jsonl`, input.contentBlocks),
	];
	const refs: StoredArtifactRef[] = [];
	for (const artifact of artifacts) {
		refs.push(
			await input.artifactStore.putObject({
				contentType: artifact.contentType,
				data: textEncoder.encode(artifact.body),
				objectKey: artifact.objectKey,
				recordCount: artifact.recordCount,
			}),
		);
	}
	return {
		bundlePage: {
			rawAssetId: input.manifest.rawAssetId,
			rawVersionId: input.manifest.rawVersionId,
			normalizedCanonicalUrl: input.manifest.normalizedCanonicalUrl,
			pageManifestObjectKey: `${prefix}/source-truth/page-manifest.json`,
			contentBlocksObjectKey: `${prefix}/source-truth/content-blocks.jsonl`,
			discoveredLinksObjectKey: `${prefix}/provider/cheerio/discovered-links.jsonl`,
			responseHtmlObjectKey: `${prefix}/capture/response.html`,
			responseBodyHash: input.manifest.responseBodyHash,
			blockCount: input.contentBlocks.length,
		},
		refs,
	};
}

export async function uploadRunArtifacts(input: {
	artifactStore: OfficialWebNextArtifactStore;
	bundle: OfficialWebNextSourceTruthBundle;
	failures: unknown[];
	runId: string;
	siteId: string;
	validationReport: OfficialWebNextValidationReport;
}): Promise<{
	bundleRef: StoredArtifactRef;
	refs: StoredArtifactRef[];
}> {
	const prefix = `official_web_next/${input.siteId}/runs/${input.runId}`;
	const artifacts = [
		jsonArtifact(`${prefix}/source-truth-bundle.json`, input.bundle),
		jsonArtifact(`${prefix}/run-summary.json`, {
			schemaVersion: "official_web_next_run_summary.v1",
			runId: input.runId,
			siteId: input.siteId,
			pages: input.bundle.pages.length,
			failures: input.failures.length,
		}),
		ndjsonArtifact(`${prefix}/failures.jsonl`, input.failures),
		jsonArtifact(`${prefix}/validation-report.json`, input.validationReport),
	];
	const refs: StoredArtifactRef[] = [];
	for (const artifact of artifacts) {
		refs.push(
			await input.artifactStore.putObject({
				contentType: artifact.contentType,
				data: textEncoder.encode(artifact.body),
				objectKey: artifact.objectKey,
				recordCount: artifact.recordCount,
			}),
		);
	}
	const bundleRef = refs.find((ref) => ref.objectKey.endsWith("/source-truth-bundle.json"));
	if (!bundleRef) {
		throw new Error("source-truth bundle ref was not uploaded");
	}
	return {
		bundleRef,
		refs,
	};
}

function pageArtifactPrefix(input: {
	rawAssetId: string;
	rawVersionId: string;
	siteId: string;
}): string {
	return `official_web_next/${input.siteId}/source-assets/${input.rawAssetId}/${input.rawVersionId}`;
}

function jsonArtifact(objectKey: string, value: unknown) {
	return {
		body: JSON.stringify(value, null, 2),
		contentType: "application/json",
		objectKey,
		recordCount: 1,
	};
}

function ndjsonArtifact(objectKey: string, rows: unknown[]) {
	return {
		body: rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
		contentType: "application/x-ndjson",
		objectKey,
		recordCount: rows.length,
	};
}

function textArtifact(objectKey: string, contentType: string, body: string) {
	return {
		body,
		contentType,
		objectKey,
		recordCount: 1,
	};
}

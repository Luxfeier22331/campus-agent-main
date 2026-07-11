export interface StoredArtifactRef {
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	recordCount?: number;
}

export interface OfficialWebNextArtifactStore {
	putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef>;
}

export type OfficialWebNextDiscoveryMethod = "seed" | "sitemap" | "manual" | "known_url";
export type OfficialWebNextRenderMode = "html" | "browser";

export interface OfficialWebNextWorksetItem {
	url: string;
	host: string;
	discoveryMethod: OfficialWebNextDiscoveryMethod;
	renderMode?: OfficialWebNextRenderMode;
}

export interface OfficialWebNextCrawlPolicy {
	respectRobots: boolean;
	userAgent: string;
}

export interface OfficialWebNextCaptureInput {
	artifactStore: OfficialWebNextArtifactStore;
	crawlPolicy?: Partial<OfficialWebNextCrawlPolicy>;
	limits?: {
		maxConcurrency: number;
		maxRequests: number;
		sameDomainDelayMs: number;
	};
	runId: string;
	siteId: string;
	workset: OfficialWebNextWorksetItem[];
}

export interface OfficialWebNextValidationReport {
	failures: string[];
	schemaVersion: "official_web_next_validation_report.v1";
	warnings: string[];
}

export interface OfficialWebNextCaptureResult {
	artifactRefs: StoredArtifactRef[];
	pagesFailed: number;
	pagesFetched: number;
	runId: string;
	sourceTruthBundleRef: StoredArtifactRef;
	validationReport: OfficialWebNextValidationReport;
}

export interface OfficialWebNextContentBlock {
	schemaVersion: "official_web_next_content_block.v1";
	rawAssetId: string;
	rawVersionId: string;
	rowIndex: number;
	blockRole: "title" | "heading" | "paragraph" | "list_item" | "table" | "link" | "image";
	headingLevel: number | null;
	textNormalized: string | null;
	linkTarget: string | null;
	tableCells: string[][] | null;
	isMainContent: boolean;
}

export interface OfficialWebNextDiscoveredLink {
	schemaVersion: "official_web_next_discovered_link.v1";
	rawAssetId: string;
	rawVersionId: string;
	linkOrder: number;
	sourceUrl: string;
	hrefRaw: string;
	resolvedUrl: string | null;
	admitted: boolean;
	admissionReason: "same_host" | "cross_host" | "invalid_url";
}

export interface OfficialWebNextPageManifest {
	schemaVersion: "official_web_next_page_manifest.v1";
	sourceChannel: "official_web";
	siteId: string;
	host: string;
	rawAssetId: string;
	rawVersionId: string;
	requestedUrl: string;
	finalUrl: string;
	normalizedCanonicalUrl: string;
	fetchedAt: string;
	httpStatus: number;
	contentType: string;
	etag: string | null;
	lastModified: string | null;
	responseBodyHash: string;
	pageTitleNormalized: string;
	languageHint: string | null;
	mainContentHash: string;
	blockCount: number;
	discoveryMethod: OfficialWebNextDiscoveryMethod;
	renderMode: OfficialWebNextRenderMode;
	crawlRunId: string;
}

export interface OfficialWebNextBundlePage {
	rawAssetId: string;
	rawVersionId: string;
	normalizedCanonicalUrl: string;
	pageManifestObjectKey: string;
	contentBlocksObjectKey: string;
	discoveredLinksObjectKey: string;
	responseHtmlObjectKey: string;
	responseBodyHash: string;
	blockCount: number;
}

export interface OfficialWebNextSourceTruthBundle {
	schemaVersion: "official_web_next_source_truth_bundle.v1";
	sourceChannel: "official_web";
	siteId: string;
	crawlRunId: string;
	generatedAt: string;
	pages: OfficialWebNextBundlePage[];
}

import { createHash } from "node:crypto";

import {
	OFFICIAL_WEB_SOURCE_CHANNEL,
	type OfficialWebConsumerFamily,
	type OfficialWebConsumerMaterializationPolicy,
	type OfficialWebConsumerRequiredEvidence,
	type OfficialWebCredentialsMode,
	type OfficialWebDiscoveryMethod,
	type OfficialWebTargetRetentionPolicy,
} from "./config.ts";
import type { OfficialWebUrlIdentityBasis } from "./policy.ts";

export const OFFICIAL_WEB_SOURCE_ARTIFACT_STAGES = ["capture", "provider", "source-truth"] as const;
export const OFFICIAL_WEB_SOURCE_YEAR_LABEL = "undated";
export const OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT = "source-truth-bundle.json" as const;
export const OFFICIAL_WEB_PAGE_FAMILIES = [
	"article_detail",
	"listing_page",
	"directory_page",
	"sitemap_navigation_page",
	"data_table_page",
	"gallery_page",
	"contact_widget_page",
	"structural_shell_page",
	"dynamic_shell_page",
	"generic_content_page",
] as const;

export type OfficialWebSourceArtifactStage = (typeof OFFICIAL_WEB_SOURCE_ARTIFACT_STAGES)[number];
export type OfficialWebBlockRole =
	| "title"
	| "heading"
	| "paragraph"
	| "list_item"
	| "table"
	| "table_row"
	| "table_cell"
	| "link"
	| "navigation"
	| "footer"
	| "metadata";
export type OfficialWebPageFamily = (typeof OFFICIAL_WEB_PAGE_FAMILIES)[number];

export interface OfficialWebPageSignalSummary {
	mainContentBlockCount: number;
	mainHeadingCount: number;
	mainParagraphCount: number;
	mainListItemCount: number;
	mainLinkCount: number;
	shortMainLinkCount: number;
	mainTableCount: number;
	listingTableCount: number;
	galleryTableCount: number;
	contactLikeMainBlockCount: number;
	dateLikeMainBlockCount: number;
	repeatedNonMainBlockCount: number;
	mainContentCharacterCount: number;
	zeroMainContent: boolean;
	structuralShellSignal: boolean;
	dynamicShellSignal: boolean;
}

export interface OfficialWebConsumerMatch {
	consumerFamily: OfficialWebConsumerFamily;
	ownerSurface: string;
	ownerAgentOrRuntime: string;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	selectedWriteTarget: string;
	reviewPolicy: string;
	matchedEvidence: OfficialWebConsumerRequiredEvidence[];
	matchedKeywords: string[];
	matchedPatterns: string[];
}

export interface OfficialWebPageTargetMatch {
	sourcePackId?: string | null;
	sourcePackEntryId?: string | null;
	compositionGroup?: string | null;
	compositionRole?: string | null;
	targetJobId: string;
	targetCandidateId: string | null;
	targetId: string;
	targetDeclarationVersion: string;
	consumerFamily: OfficialWebConsumerFamily;
	retentionPolicy: OfficialWebTargetRetentionPolicy;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	selectedWriteTarget: string;
	reviewPolicy: string;
	worksetReason: string;
}

export interface OfficialWebPageManifest {
	schemaVersion: "official_web_page_manifest.v1";
	sourceChannel: typeof OFFICIAL_WEB_SOURCE_CHANNEL;
	siteId: string;
	host: string;
	rawAssetId: string;
	rawVersionId: string;
	requestedUrl: string;
	finalUrl: string;
	declaredCanonicalUrl: string | null;
	normalizedCanonicalUrl: string;
	urlIdentityBasis: OfficialWebUrlIdentityBasis;
	fetchedAt: string;
	publishedAt: string | null;
	httpStatus: number;
	contentType: string;
	etag: string | null;
	lastModified: string | null;
	redirectChain: string[];
	responseBodyHash: string;
	retainedSnapshotHash: string;
	fetcherName: string;
	fetcherVersion: string;
	parserName: string;
	parserVersion: string;
	pageTitleRaw: string | null;
	pageTitleNormalized: string;
	languageHint: string | null;
	pageFamily: OfficialWebPageFamily;
	pageFamilyConfidence: number;
	pageFamilyReason: string | null;
	mainContentHash: string;
	blockCount: number;
	mainContentBlockCount: number;
	navigationBlockCount: number;
	boilerplateBlockCount: number;
	discoveredFromUrl: string | null;
	discoveryMethod: OfficialWebDiscoveryMethod;
	crawlRunId: string;
	hostPolicyVersion: string;
	crawlPolicyVersion: string;
	credentialsMode: OfficialWebCredentialsMode;
	consumerDenominatorVersion?: string;
	consumerMatches?: OfficialWebConsumerMatch[];
	consumerRetentionDecision?: "retain_source_truth" | "discovery_only" | "reject";
	consumerRejectionReason?: string | null;
	sourcePackId?: string | null;
	sourcePackEntryId?: string | null;
	compositionGroup?: string | null;
	compositionRole?: string | null;
	targetJobId?: string;
	targetCandidateId?: string | null;
	targetDeclarationVersion?: string;
	targetMatches?: OfficialWebPageTargetMatch[];
	materializationPolicy?: OfficialWebConsumerMaterializationPolicy;
	selectedWriteTarget?: string;
	reviewPolicy?: string;
}

export interface OfficialWebContentBlockRow {
	schemaVersion: "official_web_content_block.v1";
	rawAssetId: string;
	rawVersionId: string;
	rowId: string;
	rowIndex: number;
	blockOrder: number;
	blockRole: OfficialWebBlockRole;
	headingLevel: number | null;
	domPath: string | null;
	parentHeadingPath: string[];
	listLevel: number | null;
	tableId: string | null;
	tableRowIndex: number | null;
	tableColIndex: number | null;
	textRaw: string | null;
	textNormalized: string | null;
	htmlFragment: string | null;
	linkTarget: string | null;
	linkText: string | null;
	tableHtml: string | null;
	tableCells: string[][] | null;
	isNavigation: boolean;
	isBoilerplate: boolean;
	isMainContent: boolean;
	isRepeatedCandidate: boolean;
	mainContentScore: number;
	titleCandidateScore: number;
	sectionHint: string | null;
	classificationConfidence: number;
	classificationReason: string | null;
	parentHeadingHint: string | null;
}

export interface OfficialWebDiscoveredLinkRecord {
	schemaVersion: "official_web_discovered_link.v1";
	rawAssetId: string;
	rawVersionId: string;
	rowId: string;
	linkOrder: number;
	sourceUrl: string;
	hrefRaw: string;
	resolvedUrl: string | null;
	normalizedUrl: string | null;
	linkText: string | null;
	rel: string | null;
	admitted: boolean;
	admissionReason: string;
}

export interface OfficialWebProviderPageExtraction {
	schemaVersion: "official_web_provider_page_extraction.v1";
	rawAssetId: string;
	rawVersionId: string;
	parserSlug: string;
	parserName: string;
	parserVersion: string;
	pageTitleRaw: string | null;
	pageTitleNormalized: string;
	languageHint: string | null;
	pageFamily: OfficialWebPageFamily;
	pageFamilyConfidence: number;
	pageFamilyReason: string | null;
	mainContentHash: string;
	extractionSummary: {
		blockCount: number;
		mainContentBlockCount: number;
		navigationBlockCount: number;
		boilerplateBlockCount: number;
		discoveredLinkCount: number;
	};
	pageSignals: OfficialWebPageSignalSummary;
	blockCandidates: Array<{
		rowId: string;
		blockRole: OfficialWebBlockRole;
		textNormalized: string | null;
		domPath: string | null;
		isNavigation: boolean;
		isBoilerplate: boolean;
		isMainContent: boolean;
		mainContentScore: number;
	}>;
}

export interface OfficialWebSourceTruthBundlePage {
	rawAssetId: string;
	rawVersionId: string;
	normalizedCanonicalUrl: string;
	pageFamily: OfficialWebPageFamily;
	sourcePackId?: string | null;
	sourcePackEntryId?: string | null;
	compositionGroup?: string | null;
	compositionRole?: string | null;
	pageManifestObjectKey: string;
	contentBlocksObjectKey: string;
	providerExtractionObjectKey: string;
	discoveredLinksObjectKey: string;
	responseHtmlObjectKey: string;
	responseBodyHash: string;
	blockCount: number;
	consumerMatches?: OfficialWebConsumerMatch[];
	consumerRetentionDecision?: "retain_source_truth" | "discovery_only" | "reject";
	consumerRejectionReason?: string | null;
	targetJobId?: string;
	targetCandidateId?: string | null;
	targetDeclarationVersion?: string;
	targetMatches?: OfficialWebPageTargetMatch[];
	materializationPolicy?: OfficialWebConsumerMaterializationPolicy;
	selectedWriteTarget?: string;
	reviewPolicy?: string;
}

export interface OfficialWebSourceTruthBundle {
	schemaVersion: "official_web_source_truth_bundle.v1";
	sourceChannel: typeof OFFICIAL_WEB_SOURCE_CHANNEL;
	siteId: string;
	crawlRunId: string;
	generatedAt: string;
	collectionMode?: "target-workset" | "legacy-broad-crawl";
	legacyBroadCrawlAdmission?: {
		exclusionDecision: "legacy_contract_excluded";
		reason: string;
	};
	targetSummary?: {
		targetJobs: Record<string, number>;
		consumerFamilies: Record<string, number>;
		retentionDecisions: Record<string, number>;
		materializationPolicies: Record<string, number>;
	};
	pages: OfficialWebSourceTruthBundlePage[];
}

export function hashOfficialWebContent(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function buildOfficialWebRawAssetId(input: {
	siteId: string;
	normalizedCanonicalUrl: string;
}): string {
	return `owasset_${hashOfficialWebContent(
		`${input.siteId}\n${input.normalizedCanonicalUrl}`,
	).slice(0, 24)}`;
}

export function buildOfficialWebRawVersionId(input: {
	normalizedCanonicalUrl: string;
	responseBodyHash: string;
	mainContentHash: string;
}): string {
	return `owver_${hashOfficialWebContent(
		`${input.normalizedCanonicalUrl}\n${input.responseBodyHash}\n${input.mainContentHash}`,
	).slice(0, 24)}`;
}

export function buildOfficialWebSourceArtifactKey(input: {
	rawAssetId: string;
	rawVersionId: string;
	stage: OfficialWebSourceArtifactStage;
	filename: string;
	parserSlug?: string;
	year?: string;
}): string {
	const prefix = [
		OFFICIAL_WEB_SOURCE_CHANNEL,
		validatePathSegment(input.rawAssetId, "rawAssetId"),
		validatePathSegment(input.year ?? OFFICIAL_WEB_SOURCE_YEAR_LABEL, "year"),
		validatePathSegment(input.rawVersionId, "rawVersionId"),
		input.stage,
	];

	if (input.stage === "provider") {
		if (!input.parserSlug) {
			throw new Error("parserSlug is required for provider artifacts");
		}
		prefix.push(validatePathSegment(input.parserSlug, "parserSlug"));
	}

	return [...prefix, validateFilenameOnly(input.filename)].join("/");
}

export function buildOfficialWebPageManifest(
	input: Omit<OfficialWebPageManifest, "schemaVersion" | "sourceChannel">,
): OfficialWebPageManifest {
	return {
		schemaVersion: "official_web_page_manifest.v1",
		sourceChannel: OFFICIAL_WEB_SOURCE_CHANNEL,
		...input,
	};
}

export function buildOfficialWebContentBlockRow(
	input: Omit<OfficialWebContentBlockRow, "schemaVersion" | "rowId"> & {
		rowId?: string;
	},
): OfficialWebContentBlockRow {
	return {
		schemaVersion: "official_web_content_block.v1",
		rowId:
			input.rowId ??
			`owblock_${hashOfficialWebContent(
				`${input.rawAssetId}\n${input.rawVersionId}\n${input.rowIndex}\n${input.blockRole}\n${input.textNormalized ?? ""}`,
			).slice(0, 24)}`,
		...input,
	};
}

export function buildOfficialWebDiscoveredLinkRecord(
	input: Omit<OfficialWebDiscoveredLinkRecord, "schemaVersion" | "rowId"> & {
		rowId?: string;
	},
): OfficialWebDiscoveredLinkRecord {
	return {
		schemaVersion: "official_web_discovered_link.v1",
		rowId:
			input.rowId ??
			`owlink_${hashOfficialWebContent(
				`${input.rawAssetId}\n${input.rawVersionId}\n${input.linkOrder}\n${input.resolvedUrl ?? input.hrefRaw}`,
			).slice(0, 24)}`,
		...input,
	};
}

export function buildOfficialWebProviderPageExtraction(
	input: Omit<OfficialWebProviderPageExtraction, "schemaVersion">,
): OfficialWebProviderPageExtraction {
	return {
		schemaVersion: "official_web_provider_page_extraction.v1",
		...input,
	};
}

export function buildOfficialWebSourceTruthBundle(
	input: Omit<OfficialWebSourceTruthBundle, "schemaVersion" | "sourceChannel" | "generatedAt"> & {
		generatedAt?: string;
	},
): OfficialWebSourceTruthBundle {
	return {
		schemaVersion: "official_web_source_truth_bundle.v1",
		sourceChannel: OFFICIAL_WEB_SOURCE_CHANNEL,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		siteId: input.siteId,
		crawlRunId: input.crawlRunId,
		collectionMode: input.collectionMode,
		legacyBroadCrawlAdmission: input.legacyBroadCrawlAdmission,
		targetSummary: input.targetSummary ?? buildSourceTruthTargetSummary(input.pages),
		pages: input.pages,
	};
}

function buildSourceTruthTargetSummary(
	pages: OfficialWebSourceTruthBundlePage[],
): NonNullable<OfficialWebSourceTruthBundle["targetSummary"]> {
	const targetJobs: Record<string, number> = {};
	const consumerFamilies: Record<string, number> = {};
	const retentionDecisions: Record<string, number> = {};
	const materializationPolicies: Record<string, number> = {};

	for (const page of pages) {
		for (const match of page.targetMatches ?? []) {
			targetJobs[match.targetJobId] = (targetJobs[match.targetJobId] ?? 0) + 1;
			consumerFamilies[match.consumerFamily] = (consumerFamilies[match.consumerFamily] ?? 0) + 1;
			materializationPolicies[match.materializationPolicy] =
				(materializationPolicies[match.materializationPolicy] ?? 0) + 1;
		}
		if (page.consumerRetentionDecision) {
			retentionDecisions[page.consumerRetentionDecision] =
				(retentionDecisions[page.consumerRetentionDecision] ?? 0) + 1;
		}
	}

	return {
		targetJobs,
		consumerFamilies,
		retentionDecisions,
		materializationPolicies,
	};
}

function validateFilenameOnly(value: string): string {
	if (!value || value.includes("/")) {
		throw new Error("filename must be a non-empty basename");
	}
	return value;
}

function validatePathSegment(value: string, fieldName: string): string {
	if (!value || value.includes("/")) {
		throw new Error(`${fieldName} must be a non-empty path segment`);
	}
	return value;
}

import type { CheerioCrawlingContext } from "crawlee";
import {
	buildOfficialWebPageManifest,
	buildOfficialWebProviderPageExtraction,
	buildOfficialWebUrlIdentity,
	hashOfficialWebContent,
	type OfficialWebConfigBundle,
	type OfficialWebHostPolicy,
	type OfficialWebPageTargetMatch,
} from "./official-web-core.ts";
import { buildCollectedContentBlocks } from "./page-artifacts-blocks.ts";
import type { CollectedPageArtifact } from "./page-artifacts-contract.ts";
import {
	OFFICIAL_WEB_FETCHER_NAME,
	OFFICIAL_WEB_FETCHER_VERSION,
	OFFICIAL_WEB_PARSER_NAME,
	OFFICIAL_WEB_PARSER_SLUG,
	OFFICIAL_WEB_PARSER_VERSION,
} from "./runtime-metadata.ts";

export type {
	CollectedPageArtifact,
	CollectorArtifactFile,
} from "./page-artifacts-contract.ts";

import {
	extractDiscoveredLinks,
	looksLikeDynamicShell,
	looksLikeStructuralShell,
} from "./page-artifacts-extraction.ts";
import { buildPageArtifactFiles } from "./page-artifacts-files.ts";
import {
	extractCanonicalPublishedAt,
	normalizeOptionalString,
	normalizePageTitle,
	prepareHtmlForExtraction,
	readHeaderValue,
	serializeResponseHeaders,
} from "./page-artifacts-helpers.ts";
import { classifyPageFamily, summarizePageSignals } from "./page-artifacts-page-family.ts";

export function buildCollectedPageArtifacts(input: {
	bundle: OfficialWebConfigBundle;
	plan: {
		crawlRunId: string;
	};
	hostPolicy: OfficialWebHostPolicy;
	requestedUrl: string;
	finalUrl: string;
	declaredCanonicalUrl: string | null;
	responseBody: string;
	responseHeaders: Record<string, string | string[] | undefined>;
	httpStatus: number;
	contentType: string;
	discoveryMethod:
		| "seed"
		| "robots_sitemap"
		| "configured_sitemap"
		| "navigation"
		| "manual_requeue";
	discoveredFromUrl: string | null;
	fetchedAt: string;
	targetLineage?: OfficialWebPageTargetMatch;
	html: CheerioCrawlingContext["$"];
}): CollectedPageArtifact {
	const urlIdentity = buildOfficialWebUrlIdentity(input.bundle, {
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		declaredCanonicalUrl: input.declaredCanonicalUrl,
	});
	prepareHtmlForExtraction({
		html: input.html,
		finalUrl: input.finalUrl,
	});
	const responseBodyHash = hashOfficialWebContent(input.responseBody);
	const { contentBlocks, mainContentHash, rawAssetId, rawVersionId } = buildCollectedContentBlocks({
		html: input.html,
		baseUrl: input.finalUrl,
		normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
		responseBodyHash,
		siteDisplayName: input.bundle.site.displayName,
		siteId: input.bundle.site.siteId,
	});
	const discoveredLinks = extractDiscoveredLinks({
		html: input.html,
		baseUrl: input.finalUrl,
		bundle: input.bundle,
		hostPolicy: input.hostPolicy,
		rawAssetId,
		rawVersionId,
	});
	const languageHint = normalizeOptionalString((input.html("html").attr("lang") ?? "").trim());
	const pageTitleRaw =
		normalizeOptionalString((input.html("title").first().text() ?? "").trim()) ??
		contentBlocks.find((item) => item.blockRole === "heading" && item.headingLevel === 1)
			?.textNormalized ??
		null;
	const pageTitleNormalized = normalizePageTitle(pageTitleRaw, input.bundle.site.displayName);
	const pageSignals = summarizePageSignals({
		contentBlocks,
		html: input.html,
		responseBody: input.responseBody,
		looksLikeDynamicShell,
		looksLikeStructuralShell,
	});
	const pageFamily = classifyPageFamily({
		hostPolicy: input.hostPolicy,
		finalUrl: input.finalUrl,
		pageTitleNormalized,
		pageSignals,
	});
	const navigationBlockCount = contentBlocks.filter((item) => item.isNavigation).length;
	const boilerplateBlockCount = contentBlocks.filter((item) => item.isBoilerplate).length;
	const mainContentBlockCount = contentBlocks.filter((item) => item.isMainContent).length;
	const retainedSnapshotHash = responseBodyHash;
	const serializedHeaders = serializeResponseHeaders(input.responseHeaders);
	const redirectChain =
		input.requestedUrl === input.finalUrl ? [input.finalUrl] : [input.requestedUrl, input.finalUrl];
	const publishedAt = extractCanonicalPublishedAt({
		html: input.html,
		pageFamily: pageFamily.pageFamily,
	});

	const pageManifest = buildOfficialWebPageManifest({
		siteId: input.bundle.site.siteId,
		host: input.hostPolicy.host,
		rawAssetId,
		rawVersionId,
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		declaredCanonicalUrl: input.declaredCanonicalUrl,
		normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
		urlIdentityBasis: urlIdentity.urlIdentityBasis,
		fetchedAt: input.fetchedAt,
		publishedAt,
		httpStatus: input.httpStatus,
		contentType: input.contentType,
		etag: readHeaderValue(serializedHeaders, "etag"),
		lastModified: readHeaderValue(serializedHeaders, "last-modified"),
		redirectChain,
		responseBodyHash,
		retainedSnapshotHash,
		fetcherName: OFFICIAL_WEB_FETCHER_NAME,
		fetcherVersion: OFFICIAL_WEB_FETCHER_VERSION,
		parserName: OFFICIAL_WEB_PARSER_NAME,
		parserVersion: OFFICIAL_WEB_PARSER_VERSION,
		pageTitleRaw,
		pageTitleNormalized,
		languageHint,
		pageFamily: pageFamily.pageFamily,
		pageFamilyConfidence: pageFamily.confidence,
		pageFamilyReason: pageFamily.reason,
		mainContentHash,
		blockCount: contentBlocks.length,
		mainContentBlockCount,
		navigationBlockCount,
		boilerplateBlockCount,
		discoveredFromUrl: input.discoveredFromUrl,
		discoveryMethod: input.discoveryMethod,
		crawlRunId: input.plan.crawlRunId,
		hostPolicyVersion: input.bundle.site.hostPolicyVersion,
		crawlPolicyVersion: input.bundle.site.crawlPolicyVersion,
		credentialsMode: input.bundle.site.credentialsMode,
		consumerDenominatorVersion: input.bundle.consumerDenominator.denominatorVersion,
		targetJobId: input.targetLineage?.targetJobId,
		targetCandidateId: input.targetLineage?.targetCandidateId,
		targetDeclarationVersion: input.targetLineage?.targetDeclarationVersion,
		targetMatches: input.targetLineage ? [input.targetLineage] : undefined,
		materializationPolicy: input.targetLineage?.materializationPolicy,
		selectedWriteTarget: input.targetLineage?.selectedWriteTarget,
		reviewPolicy: input.targetLineage?.reviewPolicy,
	});

	const providerExtraction = buildOfficialWebProviderPageExtraction({
		rawAssetId,
		rawVersionId,
		parserSlug: OFFICIAL_WEB_PARSER_SLUG,
		parserName: OFFICIAL_WEB_PARSER_NAME,
		parserVersion: OFFICIAL_WEB_PARSER_VERSION,
		pageTitleRaw,
		pageTitleNormalized,
		languageHint,
		pageFamily: pageFamily.pageFamily,
		pageFamilyConfidence: pageFamily.confidence,
		pageFamilyReason: pageFamily.reason,
		mainContentHash,
		extractionSummary: {
			blockCount: contentBlocks.length,
			mainContentBlockCount,
			navigationBlockCount,
			boilerplateBlockCount,
			discoveredLinkCount: discoveredLinks.length,
		},
		pageSignals,
		blockCandidates: contentBlocks.map((item) => ({
			rowId: item.rowId,
			blockRole: item.blockRole,
			textNormalized: item.textNormalized,
			domPath: item.domPath,
			isNavigation: item.isNavigation,
			isBoilerplate: item.isBoilerplate,
			isMainContent: item.isMainContent,
			mainContentScore: item.mainContentScore,
		})),
	});
	const files = buildPageArtifactFiles({
		rawAssetId,
		rawVersionId,
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		declaredCanonicalUrl: input.declaredCanonicalUrl,
		normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
		urlIdentityBasis: urlIdentity.urlIdentityBasis,
		fetchedAt: input.fetchedAt,
		httpStatus: input.httpStatus,
		contentType: input.contentType,
		responseBody: input.responseBody,
		serializedHeaders,
		redirectChain,
		pageManifest,
		contentBlocks,
		discoveredLinks,
		providerExtraction,
	});

	return {
		rawAssetId,
		rawVersionId,
		pageManifest,
		contentBlocks,
		discoveredLinks,
		providerExtraction,
		files,
	};
}

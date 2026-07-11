import { CheerioCrawler, type CheerioCrawlingContext, type RequestOptions } from "crawlee";
import {
	type UploadedOfficialWebNextPage,
	uploadPageArtifacts,
	uploadRunArtifacts,
} from "./artifacts.ts";
import { createOfficialWebNextCrawlerConfiguration } from "./crawlee-runtime.ts";
import { extractContentBlocks, extractDiscoveredLinks, normalizeText } from "./extract.ts";
import { sha256Hex, shortHash } from "./hash.ts";
import type {
	OfficialWebNextCaptureInput,
	OfficialWebNextCaptureResult,
	OfficialWebNextCrawlPolicy,
	OfficialWebNextPageManifest,
	OfficialWebNextSourceTruthBundle,
	OfficialWebNextWorksetItem,
	StoredArtifactRef,
} from "./types.ts";

const DEFAULT_LIMITS = {
	maxConcurrency: 1,
	maxRequests: 50,
	sameDomainDelayMs: 1000,
};
const DEFAULT_CRAWL_POLICY: OfficialWebNextCrawlPolicy = {
	respectRobots: true,
	userAgent: "campus-agent-official-web-next/0.1",
};

export async function runOfficialWebNextCapture(
	input: OfficialWebNextCaptureInput,
): Promise<OfficialWebNextCaptureResult> {
	assertSupportedWorkset(input.workset);
	const limits = input.limits ?? DEFAULT_LIMITS;
	const crawlPolicy = resolveCrawlPolicy(input.crawlPolicy);
	const pages: UploadedOfficialWebNextPage[] = [];
	const failures: Record<string, unknown>[] = [];
	const artifactRefs: StoredArtifactRef[] = [];
	const worksetByUniqueKey = new Map<string, OfficialWebNextWorksetItem>();
	const requests = input.workset.map((item) => {
		const request = buildRequest(item);
		worksetByUniqueKey.set(String(request.uniqueKey), item);
		return request;
	});

	const crawler = new CheerioCrawler(
		{
			maxConcurrency: limits.maxConcurrency,
			maxRequestsPerCrawl: limits.maxRequests,
			sameDomainDelaySecs: limits.sameDomainDelayMs / 1000,
			respectRobotsTxtFile: crawlPolicy.respectRobots
				? { userAgent: crawlPolicy.userAgent }
				: false,
			preNavigationHooks: [
				async (_context, gotOptions) => {
					gotOptions.headers ??= {};
					gotOptions.headers["user-agent"] = crawlPolicy.userAgent;
					gotOptions.headers.accept = "text/html,application/xhtml+xml";
				},
			],
			requestHandler: async (context) => {
				const worksetItem = worksetByUniqueKey.get(context.request.uniqueKey);
				if (!worksetItem) {
					throw new Error(`missing workset metadata for ${context.request.url}`);
				}
				const captured = await capturePage({
					context,
					input,
					worksetItem,
				});
				pages.push(captured);
				artifactRefs.push(...captured.refs);
			},
			failedRequestHandler: async ({ request }, error) => {
				failures.push({
					schemaVersion: "official_web_next_failure.v1",
					url: request.url,
					message: error.message,
				});
			},
		},
		createOfficialWebNextCrawlerConfiguration("capture"),
	);

	await crawler.run(requests);

	const validationReport = {
		schemaVersion: "official_web_next_validation_report.v1" as const,
		failures: [],
		warnings: [],
	};
	const bundle: OfficialWebNextSourceTruthBundle = {
		schemaVersion: "official_web_next_source_truth_bundle.v1",
		sourceChannel: "official_web",
		siteId: input.siteId,
		crawlRunId: input.runId,
		generatedAt: new Date().toISOString(),
		pages: pages.map((page) => page.bundlePage),
	};
	const runArtifacts = await uploadRunArtifacts({
		artifactStore: input.artifactStore,
		bundle,
		failures,
		runId: input.runId,
		siteId: input.siteId,
		validationReport,
	});
	artifactRefs.push(...runArtifacts.refs);

	return {
		artifactRefs,
		pagesFailed: failures.length,
		pagesFetched: pages.length,
		runId: input.runId,
		sourceTruthBundleRef: runArtifacts.bundleRef,
		validationReport,
	};
}

async function capturePage(input: {
	context: CheerioCrawlingContext;
	input: OfficialWebNextCaptureInput;
	worksetItem: OfficialWebNextWorksetItem;
}): Promise<UploadedOfficialWebNextPage> {
	const finalUrl =
		input.context.request.loadedUrl ?? input.context.response.url ?? input.context.request.url;
	const responseBody = await resolveResponseBody(input.context);
	const responseHeaders = input.context.response.headers as Record<
		string,
		string | string[] | undefined
	>;
	const responseBodyHash = sha256Hex(responseBody);
	const pageTitleNormalized =
		normalizeText(input.context.$("title").first().text()) ??
		normalizeText(input.context.$("h1").first().text()) ??
		finalUrl;
	const rawAssetId = `owasset_${shortHash(`${input.input.siteId}:${new URL(finalUrl).href}`)}`;
	const blocksSeedHash = sha256Hex(input.context.$("body").text().replace(/\s+/gu, " ").trim());
	const rawVersionId = `owver_${shortHash(`${finalUrl}:${responseBodyHash}:${blocksSeedHash}`)}`;
	const contentBlocks = extractContentBlocks({
		$: input.context.$,
		baseUrl: finalUrl,
		rawAssetId,
		rawVersionId,
	});
	const mainContentHash = sha256Hex(
		contentBlocks
			.filter((block) => block.isMainContent && block.textNormalized)
			.map((block) => block.textNormalized)
			.join("\n"),
	);
	const manifest: OfficialWebNextPageManifest = {
		schemaVersion: "official_web_next_page_manifest.v1",
		sourceChannel: "official_web",
		siteId: input.input.siteId,
		host: input.worksetItem.host,
		rawAssetId,
		rawVersionId,
		requestedUrl: input.context.request.url,
		finalUrl,
		normalizedCanonicalUrl: finalUrl,
		fetchedAt: new Date().toISOString(),
		httpStatus: input.context.response.statusCode ?? 200,
		contentType: input.context.contentType.type ?? "text/html",
		etag: readHeader(responseHeaders, "etag"),
		lastModified: readHeader(responseHeaders, "last-modified"),
		responseBodyHash,
		pageTitleNormalized,
		languageHint: input.context.$("html").attr("lang") ?? null,
		mainContentHash,
		blockCount: contentBlocks.length,
		discoveryMethod: input.worksetItem.discoveryMethod,
		renderMode: input.worksetItem.renderMode ?? "html",
		crawlRunId: input.input.runId,
	};
	const discoveredLinks = extractDiscoveredLinks({
		$: input.context.$,
		baseUrl: finalUrl,
		host: input.worksetItem.host,
		rawAssetId,
		rawVersionId,
	});
	return uploadPageArtifacts({
		artifactStore: input.input.artifactStore,
		contentBlocks,
		discoveredLinks,
		manifest,
		responseBody,
		responseHeaders,
		runId: input.input.runId,
		siteId: input.input.siteId,
	});
}

function buildRequest(item: OfficialWebNextWorksetItem): RequestOptions {
	const url = new URL(item.url);
	if (url.hostname.toLowerCase() !== item.host.toLowerCase()) {
		throw new Error(`workset url host ${url.hostname} does not match declared host ${item.host}`);
	}
	return {
		uniqueKey: `${item.renderMode ?? "html"}:${url.toString()}`,
		url: url.toString(),
		userData: {
			discoveryMethod: item.discoveryMethod,
			renderMode: item.renderMode ?? "html",
		},
	};
}

function assertSupportedWorkset(workset: OfficialWebNextWorksetItem[]): void {
	const browserItem = workset.find((item) => item.renderMode === "browser");
	if (browserItem) {
		throw new Error(
			`official-web-next browser render mode is not implemented for ${browserItem.url}; add the Playwright capture path before admitting this workset`,
		);
	}
}

function resolveCrawlPolicy(
	input: OfficialWebNextCaptureInput["crawlPolicy"],
): OfficialWebNextCrawlPolicy {
	return {
		respectRobots: input?.respectRobots ?? DEFAULT_CRAWL_POLICY.respectRobots,
		userAgent: input?.userAgent ?? DEFAULT_CRAWL_POLICY.userAgent,
	};
}

async function resolveResponseBody(context: CheerioCrawlingContext): Promise<string> {
	const body = context.body;
	if (typeof body === "string") {
		return body;
	}
	if (body instanceof Buffer) {
		return body.toString("utf8");
	}
	return String(body);
}

function readHeader(
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | null {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}
	return value ?? null;
}

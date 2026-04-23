import { readFileSync } from "node:fs";
import { load } from "cheerio";

import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
} from "official-web-core";
import * as collector from "../src/index";
import * as pageArtifactsModule from "../src/page-artifacts";

export {
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	SAMPLE_PAGE_HTML,
	writeTestConfigRoot,
} from "./test-support";

export type CrawlSiteFn = (
	siteId: string,
	options: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function getCrawlSite(): CrawlSiteFn {
	const crawlSite = (
		collector as unknown as {
			crawlSite?: CrawlSiteFn;
		}
	).crawlSite;
	if (typeof crawlSite !== "function") {
		throw new TypeError("collector.crawlSite must be a function");
	}
	return crawlSite as CrawlSiteFn;
}

type ResolveCollectorCrawlMainInputFn = (
	argv: string[],
	env: Record<string, string | undefined>,
) => unknown;

export function getResolveCollectorCrawlMainInput(): ResolveCollectorCrawlMainInputFn {
	const resolveCollectorCrawlMainInput = (
		collector as unknown as {
			resolveCollectorCrawlMainInput?: ResolveCollectorCrawlMainInputFn;
		}
	).resolveCollectorCrawlMainInput;
	if (typeof resolveCollectorCrawlMainInput !== "function") {
		throw new TypeError("collector.resolveCollectorCrawlMainInput must be a function");
	}
	return resolveCollectorCrawlMainInput as ResolveCollectorCrawlMainInputFn;
}

type BuildCollectedPageArtifactsFn = typeof pageArtifactsModule.buildCollectedPageArtifacts;

export function getBuildCollectedPageArtifacts(): NonNullable<BuildCollectedPageArtifactsFn> {
	const buildCollectedPageArtifacts = (
		pageArtifactsModule as unknown as {
			buildCollectedPageArtifacts?: BuildCollectedPageArtifactsFn;
		}
	).buildCollectedPageArtifacts;
	if (typeof buildCollectedPageArtifacts !== "function") {
		throw new TypeError("pageArtifactsModule.buildCollectedPageArtifacts must be a function");
	}
	return buildCollectedPageArtifacts as NonNullable<BuildCollectedPageArtifactsFn>;
}

export function createCollectedPageArtifactForTest(input: {
	configRoot: string;
	crawlRunId: string;
	requestedUrl: string;
	finalUrl: string;
	declaredCanonicalUrl: string | null;
	responseBody: string;
	fetchedAt: string;
}) {
	const bundle = loadOfficialWebConfig("campus_public", { configRoot: input.configRoot });
	const plan = buildOfficialWebCrawlPlan("campus_public", {
		configRoot: input.configRoot,
		crawlRunId: input.crawlRunId,
	});
	const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
	if (!hostPolicy) {
		throw new Error("hostPolicy is required");
	}

	const buildCollectedPageArtifacts = getBuildCollectedPageArtifacts();
	return buildCollectedPageArtifacts({
		bundle,
		plan,
		hostPolicy,
		requestedUrl: input.requestedUrl,
		finalUrl: input.finalUrl,
		declaredCanonicalUrl: input.declaredCanonicalUrl,
		responseBody: input.responseBody,
		responseHeaders: {
			"content-type": "text/html; charset=utf-8",
		},
		httpStatus: 200,
		contentType: "text/html",
		discoveryMethod: "seed",
		discoveredFromUrl: null,
		fetchedAt: input.fetchedAt,
		html: load(input.responseBody),
	});
}

export function readJsonArtifact<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function readJsonlArtifact<T>(path: string): T[] {
	return readFileSync(path, "utf-8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line)) as T[];
}

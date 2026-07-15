import { readFileSync } from "node:fs";
import { load } from "cheerio";

import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
	type OfficialWebPageTargetMatch,
} from "../src/core/index.ts";
import * as collector from "../src/index.ts";
import * as pageArtifactsModule from "../src/page-artifacts";
import { buildOfficialWebTargetMatchForTest } from "./test-support";

export {
	buildOfficialWebPlannerPageForTest,
	buildOfficialWebTargetMatchForTest,
	buildTargetWorksetCandidatesForTest,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
	SAMPLE_NEWS_HOME_PAGE_HTML,
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
	targetLineage?: OfficialWebPageTargetMatch | null;
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
		targetLineage:
			input.targetLineage === null
				? undefined
				: (input.targetLineage ?? buildOfficialWebTargetMatchForTest()),
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

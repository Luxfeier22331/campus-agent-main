import { describe, expect, it } from "vitest";

import * as officialWebCore from "../../src/core/index.ts";

describe("official-web adapter core source-truth helpers", () => {
	it("derives stable raw ids and object keys for official-web source artifacts", () => {
		const core = officialWebCore as {
			buildOfficialWebRawAssetId?: (input: {
				siteId: string;
				normalizedCanonicalUrl: string;
			}) => string;
			buildOfficialWebRawVersionId?: (input: {
				normalizedCanonicalUrl: string;
				responseBodyHash: string;
				mainContentHash: string;
			}) => string;
			buildOfficialWebSourceArtifactKey?: (input: {
				rawAssetId: string;
				rawVersionId: string;
				stage: "capture" | "provider" | "source-truth";
				filename: string;
				parserSlug?: string;
				year?: string;
			}) => string;
		};

		expect(core.buildOfficialWebRawAssetId).toBeTypeOf("function");
		expect(core.buildOfficialWebRawVersionId).toBeTypeOf("function");
		expect(core.buildOfficialWebSourceArtifactKey).toBeTypeOf("function");
		if (
			!(
				core.buildOfficialWebRawAssetId &&
				core.buildOfficialWebRawVersionId &&
				core.buildOfficialWebSourceArtifactKey
			)
		) {
			return;
		}

		const rawAssetId = core.buildOfficialWebRawAssetId({
			siteId: "campus_public",
			normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
		});
		const sameRawAssetId = core.buildOfficialWebRawAssetId({
			siteId: "campus_public",
			normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
		});
		const rawVersionId = core.buildOfficialWebRawVersionId({
			normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
			responseBodyHash: "bodyhash001",
			mainContentHash: "mainhash001",
		});
		const changedRawVersionId = core.buildOfficialWebRawVersionId({
			normalizedCanonicalUrl: "https://www.example.edu/admissions?id=9",
			responseBodyHash: "bodyhash001",
			mainContentHash: "mainhash002",
		});

		expect(rawAssetId).toMatch(/^owasset_[a-f0-9]{24}$/);
		expect(rawAssetId).toBe(sameRawAssetId);
		expect(rawVersionId).toMatch(/^owver_[a-f0-9]{24}$/);
		expect(changedRawVersionId).not.toBe(rawVersionId);
		expect(
			core.buildOfficialWebSourceArtifactKey({
				rawAssetId,
				rawVersionId,
				stage: "capture",
				filename: "response.html",
			}),
		).toBe(`official_web/${rawAssetId}/undated/${rawVersionId}/capture/response.html`);
		expect(
			core.buildOfficialWebSourceArtifactKey({
				rawAssetId,
				rawVersionId,
				stage: "provider",
				parserSlug: "cheerio-basic",
				filename: "page-extraction.json",
			}),
		).toBe(
			`official_web/${rawAssetId}/undated/${rawVersionId}/provider/cheerio-basic/page-extraction.json`,
		);
		expect(
			core.buildOfficialWebSourceArtifactKey({
				rawAssetId,
				rawVersionId,
				stage: "source-truth",
				filename: "page-manifest.json",
			}),
		).toBe(`official_web/${rawAssetId}/undated/${rawVersionId}/source-truth/page-manifest.json`);
	});

	it("uses the app-api terminal status vocabulary for crawl run records", () => {
		const record = officialWebCore.buildOfficialWebCrawlRunRecord({
			siteId: "campus_public",
			crawlRunId: "owrun_test_001",
			runIntent: "baseline",
			startedAt: "2026-03-29T01:00:00.000Z",
			finishedAt: "2026-03-29T01:10:00.000Z",
			status: "completed_with_errors",
			counters: {
				urlsObserved: 4,
				urlsFetched: 3,
				failures: 1,
				hostsPlanned: 1,
				hostsCompleted: 1,
			},
		});

		expect(record.status).toBe("completed_with_errors");
		expect(record.runIntent).toBe("baseline");
	});
});

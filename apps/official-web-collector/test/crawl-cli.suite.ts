import { expect, it } from "vitest";

import { getResolveCollectorCrawlMainInput } from "./crawl-test-support";

export function registerCrawlCliSuite() {
	it("resolves crawl CLI input from env-backed control-plane settings", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();
		const result = resolveCollectorCrawlMainInput(
			["--site-id", "campus_public", "--crawl-run-id", "owrun_manual"],
			{
				OFFICIAL_WEB_APP_API_BASE_URL: "https://app-api.internal",
				OFFICIAL_WEB_SERVICE_TOKEN: "service-token",
				OFFICIAL_WEB_RUN_INTENT: "repair",
				OFFICIAL_WEB_TRACE_ID: "trace_01JQ",
				OFFICIAL_WEB_TRIGGER_TYPE: "scheduled",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_ACCESS_KEY: "minioadmin",
				OBJECT_STORE_SECRET_KEY: "minioadmin",
				OBJECT_STORE_BUCKET_SOURCE: "campus-rag-source",
			},
		) as {
			options: {
				artifactStore?: unknown;
				controlPlaneClient?: unknown;
				runIntent?: string;
				traceId?: string;
				triggerType?: string;
			};
			siteId: string;
		};

		expect(result.siteId).toBe("campus_public");
		expect(result.options.runIntent).toBe("repair");
		expect(result.options.triggerType).toBe("scheduled");
		expect(result.options.traceId).toBe("trace_01JQ");
		expect(result.options.controlPlaneClient).toBeDefined();
		expect(result.options.artifactStore).toBeDefined();
	});

	it("fails closed when control-plane config is partially provided", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();

		expect(() =>
			resolveCollectorCrawlMainInput(["--site-id", "campus_public"], {
				OFFICIAL_WEB_APP_API_BASE_URL: "https://app-api.internal",
			}),
		).toThrowError(/OFFICIAL_WEB_APP_API_BASE_URL.*OFFICIAL_WEB_SERVICE_TOKEN/);
	});

	it("does not turn default CLI input or host filters into legacy broad crawl admission", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();
		const result = resolveCollectorCrawlMainInput(
			["--site-id", "campus_public", "--host", "www.example.edu"],
			{},
		) as {
			options: {
				hostFilter?: string[];
				legacyBroadCrawlAdmission?: unknown;
			};
		};

		expect(result.options.hostFilter).toEqual(["www.example.edu"]);
		expect(result.options.legacyBroadCrawlAdmission).toBeUndefined();
	});

	it("requires an explicit legacy broad crawl flag and reason for debug/operator runs", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();

		expect(() =>
			resolveCollectorCrawlMainInput(["--site-id", "campus_public", "--legacy-broad-crawl"], {}),
		).toThrowError(/--legacy-broad-crawl-reason is required/u);

		const result = resolveCollectorCrawlMainInput(
			[
				"--site-id",
				"campus_public",
				"--legacy-broad-crawl",
				"--legacy-broad-crawl-reason",
				"manual local debug run",
			],
			{},
		) as {
			options: {
				legacyBroadCrawlAdmission?: {
					exclusionDecision?: string;
					reason?: string;
				};
			};
		};

		expect(result.options.legacyBroadCrawlAdmission).toEqual({
			exclusionDecision: "legacy_contract_excluded",
			reason: "manual local debug run",
		});
	});
}

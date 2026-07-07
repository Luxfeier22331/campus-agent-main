import { expect, it } from "vitest";

import { getResolveCollectorCrawlMainInput } from "./crawl-test-support";

export function registerCrawlCliSuite() {
	it("resolves crawl CLI input from env-backed control-plane settings", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();
		const result = resolveCollectorCrawlMainInput(
			["--site-id", "campus_public", "--crawl-run-id", "owrun_manual"],
			{
				OFFICIAL_WEB_INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				OFFICIAL_WEB_SERVICE_TOKEN: "service-token",
				OFFICIAL_WEB_RUN_INTENT: "repair",
				OFFICIAL_WEB_TRACE_ID: "trace_01JQ",
				OFFICIAL_WEB_TRIGGER_TYPE: "scheduled",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "minioadmin",
				OBJECT_STORE_SOURCE_SECRET_KEY: "minioadmin",
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
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
				OFFICIAL_WEB_INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
			}),
		).toThrowError(/OFFICIAL_WEB_INGESTION_CONTROL_BASE_URL.*OFFICIAL_WEB_SERVICE_TOKEN/);
	});

	it("requires control-plane config before CLI can construct executable crawl input", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();

		expect(() =>
			resolveCollectorCrawlMainInput(
				["--site-id", "campus_public", "--host", "www.example.edu"],
				{},
			),
		).toThrowError(/OFFICIAL_WEB_INGESTION_CONTROL_BASE_URL.*OFFICIAL_WEB_SERVICE_TOKEN/u);
	});

	it("marks local artifact-only execution explicitly when requested", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();
		const result = resolveCollectorCrawlMainInput(
			["--site-id", "campus_public", "--local-artifacts-only"],
			{
				OFFICIAL_WEB_INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				OFFICIAL_WEB_SERVICE_TOKEN: "service-token",
			},
		) as {
			options: {
				artifactStore?: unknown;
				localArtifactsOnly?: boolean;
			};
		};

		expect(result.options.artifactStore).toBeUndefined();
		expect(result.options.localArtifactsOnly).toBe(true);
	});

	it("rejects removed broad crawl CLI flags", () => {
		const resolveCollectorCrawlMainInput = getResolveCollectorCrawlMainInput();
		const removedFlag = `--legacy-${"broad"}-crawl`;

		expect(() =>
			resolveCollectorCrawlMainInput(["--site-id", "campus_public", removedFlag], {}),
		).toThrowError(/Unknown option/u);
		expect(() =>
			resolveCollectorCrawlMainInput(
				["--site-id", "campus_public", `${removedFlag}-reason`, "debug"],
				{},
			),
		).toThrowError(/Unknown option/u);
	});
}

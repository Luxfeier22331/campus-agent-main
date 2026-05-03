import { parseArgs } from "node:util";

import { createS3ArtifactStoreFromEnv } from "./artifact-store.ts";
import { normalizeCliArgs } from "./cli.ts";
import type { CrawlSiteOptions, CrawlSiteResult } from "./crawl.ts";
import {
	buildConfiguredControlPlaneClient,
	firstNonEmptyString,
	parseOptionalInt,
	parseRunIntent,
	parseTriggerType,
} from "./crawl-support.ts";

interface CollectorCliEnvironment {
	OFFICIAL_WEB_APP_API_BASE_URL?: string;
	OFFICIAL_WEB_SERVICE_TOKEN?: string;
	OFFICIAL_WEB_RUN_INTENT?: string;
	OFFICIAL_WEB_TRACE_ID?: string;
	OFFICIAL_WEB_TRIGGER_TYPE?: string;
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SECRET_KEY?: string;
}

export interface ResolvedCollectorCrawlMainInput {
	options: CrawlSiteOptions;
	siteId: string;
}

export async function runCollectorCrawlMain(
	runCrawl: (siteId: string, options: CrawlSiteOptions) => Promise<CrawlSiteResult>,
	argv: string[] = process.argv.slice(2),
): Promise<void> {
	const resolved = resolveCollectorCrawlMainInput(argv);
	const result = await runCrawl(resolved.siteId, resolved.options);

	console.log(
		JSON.stringify(
			{
				outputDir: result.outputDir,
				artifactPaths: result.artifactPaths,
				crawlRun: result.crawlRun,
				uploadedArtifacts: result.uploadedArtifacts,
			},
			null,
			2,
		),
	);
}

export function resolveCollectorCrawlMainInput(
	argv: string[] = process.argv.slice(2),
	env: CollectorCliEnvironment = process.env,
): ResolvedCollectorCrawlMainInput {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"app-api-base-url": { type: "string" },
			"site-id": { type: "string" },
			"repo-root": { type: "string" },
			"config-root": { type: "string" },
			"crawl-run-id": { type: "string" },
			"run-intent": { type: "string" },
			"scheduler-run-key": { type: "string" },
			"service-token": { type: "string" },
			"output-dir": { type: "string" },
			"trace-id": { type: "string" },
			"trigger-type": { type: "string" },
			"legacy-broad-crawl": { type: "boolean" },
			"legacy-broad-crawl-reason": { type: "string" },
			"source-pack-lineage-path": { type: "string" },
			"disable-conditional-headers": { type: "boolean" },
			host: { type: "string", multiple: true },
			"target-candidate-id": { type: "string", multiple: true },
			"max-pages-per-host": { type: "string" },
			"max-total-pages": { type: "string" },
		},
		allowPositionals: false,
	});

	const siteId = values["site-id"];
	if (typeof siteId !== "string" || siteId.length === 0) {
		throw new Error("--site-id is required");
	}

	const appApiBaseUrl = firstNonEmptyString(
		values["app-api-base-url"],
		env.OFFICIAL_WEB_APP_API_BASE_URL,
	);
	const serviceToken = firstNonEmptyString(values["service-token"], env.OFFICIAL_WEB_SERVICE_TOKEN);
	const runIntent = parseRunIntent(
		firstNonEmptyString(values["run-intent"], env.OFFICIAL_WEB_RUN_INTENT),
	);
	const triggerType = parseTriggerType(
		firstNonEmptyString(values["trigger-type"], env.OFFICIAL_WEB_TRIGGER_TYPE),
	);
	const traceId = firstNonEmptyString(values["trace-id"], env.OFFICIAL_WEB_TRACE_ID);
	const controlPlaneClient =
		appApiBaseUrl || serviceToken
			? buildConfiguredControlPlaneClient({
					appApiBaseUrl,
					serviceToken,
				})
			: undefined;
	const legacyBroadCrawlAdmission = resolveLegacyBroadCrawlAdmission({
		enabled: values["legacy-broad-crawl"],
		reason: values["legacy-broad-crawl-reason"],
	});

	return {
		options: {
			repoRoot: values["repo-root"],
			configRoot: values["config-root"],
			crawlRunId: values["crawl-run-id"],
			runIntent,
			schedulerRunKey: values["scheduler-run-key"],
			triggerType,
			traceId,
			outputDir: values["output-dir"],
			hostFilter: values.host,
			targetCandidateIds: values["target-candidate-id"],
			maxPagesPerHost: parseOptionalInt(values["max-pages-per-host"]),
			maxTotalPages: parseOptionalInt(values["max-total-pages"]),
			artifactStore: createS3ArtifactStoreFromEnv(env),
			controlPlaneClient,
			legacyBroadCrawlAdmission,
			sourcePackLineagePath: values["source-pack-lineage-path"],
			disableConditionalHeaders: values["disable-conditional-headers"],
		},
		siteId,
	};
}

function resolveLegacyBroadCrawlAdmission(input: {
	enabled?: boolean;
	reason?: string;
}): CrawlSiteOptions["legacyBroadCrawlAdmission"] {
	if (!input.enabled) {
		if (typeof input.reason === "string" && input.reason.trim().length > 0) {
			throw new Error("--legacy-broad-crawl is required when --legacy-broad-crawl-reason is set");
		}
		return;
	}
	if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
		throw new Error("--legacy-broad-crawl-reason is required when --legacy-broad-crawl is set");
	}

	return {
		exclusionDecision: "legacy_contract_excluded",
		reason: input.reason.trim(),
	};
}

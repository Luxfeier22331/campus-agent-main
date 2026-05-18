import { OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS } from "./artifacts.ts";
import { loadOfficialWebConfig } from "./config-loading.ts";
import type {
	OfficialWebCrawlPlan,
	OfficialWebRunIntent,
	OfficialWebSchedulerPlan,
} from "./config-models.ts";
import { asRunIntent } from "./config-parsing.ts";

function toCompactUtc(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const second = String(date.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function buildCrawlRunId(siteId: string, now: Date = new Date()): string {
	return `${siteId}-${toCompactUtc(now)}`;
}

export function buildOfficialWebCrawlPlan(
	siteId: string,
	options: {
		repoRoot?: string;
		configRoot?: string;
		sourcePackId?: string;
		now?: Date;
		crawlRunId?: string;
		runIntent?: OfficialWebRunIntent;
	} = {},
): OfficialWebCrawlPlan {
	const bundle = loadOfficialWebConfig(siteId, options);
	const now = options.now ?? new Date();
	return {
		siteId: bundle.site.siteId,
		crawlRunId: options.crawlRunId ?? buildCrawlRunId(bundle.site.siteId, now),
		runIntent: options.runIntent == null ? "baseline" : asRunIntent(options.runIntent),
		generatedAt: now.toISOString(),
		configVersion: bundle.site.configVersion,
		hostPolicyVersion: bundle.site.hostPolicyVersion,
		crawlPolicyVersion: bundle.site.crawlPolicyVersion,
		schedulerPolicyVersion: bundle.schedulerPolicy.schedulerPolicyVersion,
		seedSetVersion: bundle.site.seedSetVersion,
		credentialsMode: bundle.site.credentialsMode,
		entryHost: bundle.site.entryHost,
		enabledHosts: bundle.hosts.hosts
			.filter((item) => item.enabled)
			.map((item) => ({
				host: item.host,
				publicKind: item.publicKind,
				hostGroup: item.hostGroup,
				ownerLabel: item.ownerLabel,
				rolloutOrder: item.rolloutOrder,
				maxDepth: item.maxDepth,
				maxPagesPerRun: item.maxPagesPerRun,
				maxConcurrency: item.maxConcurrency,
				minDelayMs: item.minDelayMs,
			})),
		seeds: bundle.seeds.seeds.map((seed) => ({
			seedId: seed.seedId,
			url: seed.url,
			host: seed.host,
			reason: seed.reason,
		})),
		discoveryOrder: bundle.crawlPolicy.discoveryOrder,
		runLimits: {
			maxTotalPagesPerRun: bundle.crawlPolicy.maxTotalPagesPerRun,
			maxTotalFailuresPerRun: bundle.crawlPolicy.maxTotalFailuresPerRun,
			maxRuntimeMinutes: bundle.crawlPolicy.maxRuntimeMinutes,
		},
		requiredArtifacts: [...OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS],
	};
}

export function buildOfficialWebSchedulerPlan(
	siteId: string,
	options: {
		repoRoot?: string;
		configRoot?: string;
		sourcePackId?: string;
		now?: Date;
	} = {},
): OfficialWebSchedulerPlan {
	const bundle = loadOfficialWebConfig(siteId, options);
	const now = options.now ?? new Date();

	return {
		generatedAt: now.toISOString(),
		schedulerPolicyVersion: bundle.schedulerPolicy.schedulerPolicyVersion,
		siteId: bundle.site.siteId,
		timezone: bundle.schedulerPolicy.timezone,
		lanes: bundle.schedulerPolicy.lanes.map((lane) => ({
			...lane,
			schedulerRunKeyPattern: `${bundle.site.siteId}:${lane.laneId}:{scheduled-at-iso}`,
			siteId: bundle.site.siteId,
		})),
	};
}

import type { Configuration } from "crawlee";
import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";

import type {
	CollectorAggregatedResults,
	CollectorProgressCounts,
} from "./crawl-internal-types.ts";
import { summarizeProgressCounts } from "./crawl-progress.ts";
import { crawlSingleHost } from "./crawl-single-host.ts";
import type {
	OfficialWebDynamicShellDiscoverer,
	OfficialWebDynamicShellDiscoveryAudit,
} from "./dynamic-shell-discovery.ts";
import {
	buildOfficialWebFailureRecord,
	findOfficialWebHostPolicy,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebFailureRecord,
	type OfficialWebHostSummaryRecord,
	type OfficialWebPageObservationRecord,
	type OfficialWebUrlResultRecord,
} from "./official-web-core.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export interface CrawlHostsWithCrawleeInput {
	bundle: OfficialWebConfigBundle;
	dynamicPlan: {
		duePages: OfficialWebPlannerPageCandidate[];
		resolvedAt: string;
		summary: {
			duePages: number;
			listingPages: number;
			repairPages: number;
			selectedHosts: number;
			staticPages: number;
		};
	};
	plan: OfficialWebCrawlPlan;
	config: Configuration;
	hostFilter?: string[];
	maxPagesPerHost: number;
	maxTotalPages: number;
	dynamicShellDiscoverer?: OfficialWebDynamicShellDiscoverer;
	reportProgress?: (counts: CollectorProgressCounts) => Promise<void>;
}

export async function crawlHostsWithCrawlee(
	input: CrawlHostsWithCrawleeInput,
): Promise<CollectorAggregatedResults> {
	const hostFilter = new Set((input.hostFilter ?? []).map((item) => item.toLowerCase()));
	const selectedHosts = input.plan.enabledHosts.filter(
		(item) => hostFilter.size === 0 || hostFilter.has(item.host.toLowerCase()),
	);

	const hostSummaries: OfficialWebHostSummaryRecord[] = [];
	const pageObservations: OfficialWebPageObservationRecord[] = [];
	const urlResults: OfficialWebUrlResultRecord[] = [];
	const failures: OfficialWebFailureRecord[] = [];
	const pages: CollectedPageArtifact[] = [];
	const dynamicShellDiscoveryAudits: OfficialWebDynamicShellDiscoveryAudit[] = [];
	let remainingTotalPages = input.maxTotalPages;

	for (const plannedHost of selectedHosts) {
		if (
			remainingTotalPages <= 0 ||
			failures.length >= input.plan.runLimits.maxTotalFailuresPerRun
		) {
			break;
		}

		const hostPolicy = findOfficialWebHostPolicy(input.bundle, plannedHost.host);
		if (!hostPolicy) {
			failures.push(
				buildOfficialWebFailureRecord({
					siteId: input.plan.siteId,
					crawlRunId: input.plan.crawlRunId,
					host: plannedHost.host,
					url: `https://${plannedHost.host}/`,
					phase: "queue",
					reason: "host_policy_missing",
					message: `missing host policy for ${plannedHost.host}`,
					retryable: false,
				}),
			);
			if (input.reportProgress) {
				await input.reportProgress(
					summarizeProgressCounts(
						{ hostSummaries, pageObservations, urlResults, failures, pages },
						0,
					),
				);
			}
			continue;
		}

		const hostResult = await crawlSingleHost({
			bundle: input.bundle,
			plan: input.plan,
			hostPolicy,
			config: input.config,
			plannerPages: input.dynamicPlan.duePages.filter((page) => page.host === plannedHost.host),
			maxPagesForHost: Math.min(
				input.maxPagesPerHost,
				plannedHost.maxPagesPerRun,
				remainingTotalPages,
			),
			dynamicShellDiscoverer: input.dynamicShellDiscoverer,
		});
		hostSummaries.push(...hostResult.hostSummaries);
		pageObservations.push(...(hostResult.pageObservations ?? []));
		urlResults.push(...hostResult.urlResults);
		failures.push(...hostResult.failures);
		pages.push(...hostResult.pages);
		dynamicShellDiscoveryAudits.push(...(hostResult.dynamicShellDiscoveryAudits ?? []));
		remainingTotalPages -= hostResult.urlResults.length;

		if (input.reportProgress) {
			await input.reportProgress(
				summarizeProgressCounts(
					{ hostSummaries, pageObservations, urlResults, failures, pages },
					0,
				),
			);
		}
	}

	return {
		hostSummaries,
		pageObservations,
		urlResults,
		failures,
		pages,
		dynamicShellDiscoveryAudits,
	};
}

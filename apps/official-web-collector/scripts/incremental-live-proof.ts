import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { crawlSite, type OfficialWebControlPlaneClient } from "../src/index.ts";

const siteId = "muc_public";
const crawlRunId = "owrun_incremental_live_20260401";
const outputDir = "/tmp/official-web-incremental-proof-20260401";
const reportPath = resolve(outputDir, "incremental-proof-report.json");
const baseHeaders = {
	accept: "text/html,application/xhtml+xml",
	"user-agent": "official-web-incremental-proof/1.0",
};

const candidates = [
	{
		host: "www.muc.edu.cn",
		pageFamily: "generic_content_page",
		pageTitleNormalized: "中央民族大学",
		url: "https://www.muc.edu.cn/",
	},
	{
		host: "news.muc.edu.cn",
		pageFamily: "listing_page",
		pageTitleNormalized: "新闻网",
		url: "https://news.muc.edu.cn/",
	},
	{
		host: "xxgk.muc.edu.cn",
		pageFamily: "directory_page",
		pageTitleNormalized: "信息公开",
		url: "https://xxgk.muc.edu.cn/",
	},
	{
		host: "xiaoyou.muc.edu.cn",
		pageFamily: "listing_page",
		pageTitleNormalized: "校友会",
		url: "https://xiaoyou.muc.edu.cn/",
	},
] as const;

type ConditionalMode = "etag" | "last_modified";

interface IncrementalProofReport {
	attempts: Array<{
		collectorResult?: {
			httpStatus: number | null;
			outcome: string;
		};
		conditionalProbe: {
			mode: ConditionalMode;
			responseEtag: string | null;
			responseLastModified: string | null;
			status: number;
		};
		host: string;
		selectedToken: {
			etag: string | null;
			lastModified: string | null;
			mode: ConditionalMode;
		};
		sourceUrl: string;
	}>;
	selectedAttempt: {
		collectorResult: {
			httpStatus: number | null;
			outcome: string;
		};
		conditionalProbe: {
			mode: ConditionalMode;
			responseEtag: string | null;
			responseLastModified: string | null;
			status: number;
		};
		host: string;
		selectedToken: {
			etag: string | null;
			lastModified: string | null;
			mode: ConditionalMode;
		};
		sourceUrl: string;
	} | null;
	outputDir: string;
	pageObservations: unknown[];
	summary: {
		failures: number;
		pageObservations: number;
		qualityTotalPages: number;
		sourceTruthPages: number;
		urlResults: number;
	};
	urlResults: unknown[];
}

async function probeCandidate(candidate: (typeof candidates)[number]): Promise<{
	conditionalProbe: {
		mode: ConditionalMode;
		responseEtag: string | null;
		responseLastModified: string | null;
		status: number;
	};
	host: string;
	selectedToken: {
		etag: string | null;
		lastModified: string | null;
		mode: ConditionalMode;
	};
	sourceUrl: string;
} | null> {
	const baseline = await fetch(candidate.url, {
		headers: baseHeaders,
	});
	const baselineEtag = baseline.headers.get("etag");
	const baselineLastModified = baseline.headers.get("last-modified");
	await baseline.arrayBuffer();

	const probeModes: Array<{
		headers: Record<string, string>;
		mode: ConditionalMode;
	}> = [];
	if (baselineEtag) {
		probeModes.push({
			mode: "etag",
			headers: {
				...baseHeaders,
				"if-none-match": baselineEtag,
			},
		});
	}
	if (baselineLastModified) {
		probeModes.push({
			mode: "last_modified",
			headers: {
				...baseHeaders,
				"if-modified-since": baselineLastModified,
			},
		});
	}

	for (const probeMode of probeModes) {
		const conditional = await fetch(candidate.url, {
			headers: probeMode.headers,
		});
		const conditionalResult = {
			mode: probeMode.mode,
			status: conditional.status,
			responseEtag: conditional.headers.get("etag"),
			responseLastModified: conditional.headers.get("last-modified"),
		};
		await conditional.arrayBuffer();

		if (conditional.status !== 304) {
			continue;
		}

		return {
			host: candidate.host,
			sourceUrl: candidate.url,
			selectedToken: {
				mode: probeMode.mode,
				etag: probeMode.mode === "etag" ? baselineEtag : null,
				lastModified: probeMode.mode === "last_modified" ? baselineLastModified : null,
			},
			conditionalProbe: conditionalResult,
		};
	}

	return null;
}

async function main(): Promise<void> {
	rmSync(outputDir, { force: true, recursive: true });
	mkdirSync(outputDir, { recursive: true });

	const attempts: IncrementalProofReport["attempts"] = [];
	for (const candidate of candidates) {
		const probed = await probeCandidate(candidate);
		if (!probed) {
			continue;
		}

		const controlPlaneClient: OfficialWebControlPlaneClient = {
			async startRun() {
				return {
					run: {
						runId: crawlRunId,
						siteId,
						startedAt: new Date().toISOString(),
						status: "accepted",
					},
				};
			},
			async sendHeartbeat(input) {
				return {
					run: {
						runId: input.runId,
						status: "accepted",
					},
				};
			},
			async resolvePlan() {
				return {
					plan: {
						duePages: [
							{
								cadenceClass: "detail_recent",
								contentType: "text/html",
								discoveredFromUrl: null,
								discoveryMethod: "seed",
								etag: probed.selectedToken.etag,
								host: candidate.host,
								lastChangeReason: "live_probe",
								lastChangedAt: null,
								lastFetchDisposition: "fetched",
								lastHttpStatus: 200,
								lastModified: probed.selectedToken.lastModified,
								lastNotModifiedAt: null,
								lastSeenAt: new Date().toISOString(),
								lastSuccessfulRunId: "owrun_live_probe_previous",
								mainContentHash: "live-probe-main-hash",
								nextEligibleFetchAt: new Date().toISOString(),
								normalizedCanonicalUrl: candidate.url,
								pageFamily: candidate.pageFamily,
								pageTitleNormalized: candidate.pageTitleNormalized,
								priorityScore: 10,
								responseBodyHash: "live-probe-body-hash",
								siteId,
							},
						],
						hostFilter: [candidate.host],
						maxPagesPerHost: 1,
						maxTotalPages: 1,
						resolvedAt: new Date().toISOString(),
						runIntent: "baseline",
						siteId,
						summary: {
							duePages: 1,
							listingPages: 0,
							repairPages: 0,
							selectedHosts: 1,
							staticPages: 1,
						},
					},
				};
			},
			async finalizeRun(input) {
				return {
					run: {
						runId: input.runId,
						status: input.terminalStatus,
						finishedAt: input.finishedAt,
					},
				};
			},
		};

		const result = await crawlSite(siteId, {
			crawlRunId,
			hostFilter: [candidate.host],
			maxPagesPerHost: 1,
			maxTotalPages: 1,
			outputDir,
			controlPlaneClient,
		});
		const collectorResult = {
			outcome: result.urlResults[0]?.outcome ?? "missing",
			httpStatus: result.urlResults[0]?.httpStatus ?? null,
		};
		const attempt = {
			...probed,
			collectorResult,
		};
		attempts.push(attempt);

		if (collectorResult.outcome === "not_modified") {
			const report: IncrementalProofReport = {
				attempts,
				selectedAttempt: attempt,
				outputDir,
				summary: {
					sourceTruthPages: result.sourceTruthBundle.pages.length,
					qualityTotalPages: result.qualityAudit.summary.totalPages,
					urlResults: result.urlResults.length,
					pageObservations: result.pageObservations.length,
					failures: result.failures.length,
				},
				urlResults: result.urlResults,
				pageObservations: result.pageObservations,
			};

			writeFileSync(reportPath, JSON.stringify(report, null, 2));
			console.log(JSON.stringify(report, null, 2));
			return;
		}
	}

	const report: IncrementalProofReport = {
		attempts,
		selectedAttempt: null,
		outputDir,
		summary: {
			sourceTruthPages: 0,
			qualityTotalPages: 0,
			urlResults: 0,
			pageObservations: 0,
			failures: 0,
		},
		urlResults: [],
		pageObservations: [],
	};

	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	throw new Error("No live candidate produced collector outcome=not_modified.");
}

void main();

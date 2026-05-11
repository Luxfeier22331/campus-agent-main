import process from "node:process";
import { pathToFileURL } from "node:url";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import {
	buildOfficialWebProjectionProjector,
	createPgOfficialWebProjectionStore,
} from "../src/modules/official-web-projection";

export interface OfficialWebSmokeSeedArgs {
	siteId: string;
}

export interface LocalOfficialWebSmokeSeedRuntime {
	collectorToken: string;
	env: Env;
	operatorEmail: string;
}

function readOptionalString(
	sourceEnv: NodeJS.ProcessEnv,
	key: keyof NodeJS.ProcessEnv,
): string | undefined {
	const value = sourceEnv[key];
	if (typeof value !== "string") {
		return;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function readRequiredString(sourceEnv: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv): string {
	const value = readOptionalString(sourceEnv, key);
	if (!value) {
		throw new Error(`${key} is required.`);
	}

	return value;
}

export function parseOfficialWebSmokeSeedArgs(argv: string[]): OfficialWebSmokeSeedArgs {
	let siteId = "www_muc_edu_cn";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}

		if (token !== "--site-id") {
			throw new Error(`Unknown argument: ${token}`);
		}

		const value = argv[index + 1]?.trim();
		if (!value) {
			throw new Error("--site-id requires a non-empty value.");
		}
		siteId = value;
		index += 1;
	}

	return {
		siteId,
	};
}

export function buildLocalOfficialWebSmokeSeedRuntime(
	sourceEnv: NodeJS.ProcessEnv,
): LocalOfficialWebSmokeSeedRuntime {
	const connectionString = readRequiredString(
		sourceEnv,
		"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
	);
	const collectorToken = readRequiredString(sourceEnv, "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN");
	const internalSharedSecret = readRequiredString(sourceEnv, "APP_API_INTERNAL_SHARED_SECRET");
	const operatorAllowlist = readRequiredString(sourceEnv, "APP_API_OPERATOR_EMAIL_ALLOWLIST");
	const operatorEmail = operatorAllowlist
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.find(Boolean);

	if (!operatorEmail) {
		throw new Error("APP_API_OPERATOR_EMAIL_ALLOWLIST must include at least one email.");
	}

	return {
		collectorToken,
		env: {
			APP_API_DATABASE_SSLMODE: readOptionalString(sourceEnv, "APP_API_DATABASE_SSLMODE") as
				| Env["APP_API_DATABASE_SSLMODE"]
				| undefined,
			APP_API_DB: {
				connectionString,
			},
			APP_API_ENVIRONMENT: readOptionalString(sourceEnv, "APP_API_ENVIRONMENT") as
				| Env["APP_API_ENVIRONMENT"]
				| undefined,
			APP_API_INTERNAL_SHARED_SECRET: internalSharedSecret,
			APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: collectorToken,
			APP_API_OPERATOR_DATABASE_URL: readOptionalString(
				sourceEnv,
				"APP_API_OPERATOR_DATABASE_URL",
			),
			APP_API_OPERATOR_EMAIL_ALLOWLIST: operatorAllowlist,
		},
		operatorEmail,
	};
}

function subtractHours(input: Date, hours: number): string {
	return new Date(input.valueOf() - hours * 60 * 60 * 1000).toISOString();
}

function toHttpDate(input: string): string {
	return new Date(input).toUTCString();
}

async function expectJsonResponse<T>(response: Response, expectedStatus: number): Promise<T> {
	if (response.status !== expectedStatus) {
		const body = await response.text();
		throw new Error(`Expected ${expectedStatus}, received ${response.status}: ${body}`);
	}

	return (await response.json()) as T;
}

function createCollectorHeaders(token: string): Record<string, string> {
	return {
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
}

function createOperatorHeaders(input: {
	internalSharedSecret: string;
	operatorEmail: string;
}): Record<string, string> {
	return {
		accept: "application/json",
		"x-app-internal-auth": input.internalSharedSecret,
		"x-app-operator-email": input.operatorEmail,
	};
}

async function startRun(input: {
	app: ReturnType<typeof createApp>;
	collectorToken: string;
	configVersion: string;
	crawlPolicyVersion: string;
	hostSet: string[];
	runIntent: "baseline" | "hot" | "repair";
	schedulerRunKey: string;
	seedSet: string[];
	siteId: string;
	startedAt: string;
	triggerType: "manual" | "scheduled";
}): Promise<string> {
	const response = await input.app.fetch(
		new Request("https://app-api.internal/api/official-web/runs", {
			body: JSON.stringify({
				collectorVersion: "official-web-collector@local-smoke",
				configVersion: input.configVersion,
				crawlPolicyVersion: input.crawlPolicyVersion,
				hostSet: input.hostSet,
				runIntent: input.runIntent,
				schedulerRunKey: input.schedulerRunKey,
				seedSet: input.seedSet,
				siteId: input.siteId,
				startedAt: input.startedAt,
				triggerType: input.triggerType,
			}),
			headers: createCollectorHeaders(input.collectorToken),
			method: "POST",
		}),
	);
	const payload = await expectJsonResponse<{
		run: {
			runId: string;
		};
	}>(response, 200);

	return payload.run.runId;
}

async function postHeartbeat(input: {
	app: ReturnType<typeof createApp>;
	collectorToken: string;
	observedAt: string;
	runId: string;
	sequence: number;
	counts: {
		artifactUploads: number;
		failures: number;
		pagesNormalized: number;
		urlsDiscovered: number;
		urlsFetched: number;
	};
}): Promise<void> {
	const response = await input.app.fetch(
		new Request(`https://app-api.internal/api/official-web/runs/${input.runId}/heartbeats`, {
			body: JSON.stringify({
				counts: input.counts,
				observedAt: input.observedAt,
				sequence: input.sequence,
			}),
			headers: createCollectorHeaders(input.collectorToken),
			method: "POST",
		}),
	);
	await expectJsonResponse(response, 200);
}

async function finalizeRun(input: {
	app: ReturnType<typeof createApp>;
	artifacts: Array<{
		artifactType: string;
		contentSha256: string;
		objectKey: string;
		recordCount: number;
	}>;
	collectorToken: string;
	finishedAt: string;
	pageObservations: Record<string, unknown>[];
	runId: string;
	summary: {
		failureCount: number;
		pagesNormalized: number;
		urlsDiscovered: number;
		urlsFetched: number;
	};
	terminalStatus: "completed" | "completed_with_errors";
}): Promise<void> {
	const response = await input.app.fetch(
		new Request(`https://app-api.internal/api/official-web/runs/${input.runId}/finalize`, {
			body: JSON.stringify({
				artifacts: input.artifacts,
				finishedAt: input.finishedAt,
				pageObservations: input.pageObservations,
				summary: input.summary,
				terminalStatus: input.terminalStatus,
			}),
			headers: createCollectorHeaders(input.collectorToken),
			method: "POST",
		}),
	);
	await expectJsonResponse(response, 200);
}

export async function seedOfficialWebSmokeSamples(input: {
	args: OfficialWebSmokeSeedArgs;
	now?: Date;
	runtime: LocalOfficialWebSmokeSeedRuntime;
}): Promise<{
	detailRunId: string;
	projection: {
		abandoned: number;
		failed: number;
		processed: number;
	};
	runIds: string[];
	runsPage: {
		nextCursor: string | null;
		runCount: number;
	};
	site: {
		latestRunId: string | null;
		recentPageChanges: number;
		recentRuns: number;
		siteId: string;
		totalPages: number;
	};
}> {
	const now = input.now ?? new Date();
	const runtime = input.runtime;
	const app = createApp(runtime.env);
	const siteId = input.args.siteId;
	const host = "www.muc.edu.cn";
	const baseSeedKey = `official-web-smoke-${now.toISOString()}`;
	const internalSharedSecret = runtime.env.APP_API_INTERNAL_SHARED_SECRET;
	if (!internalSharedSecret) {
		throw new Error("APP_API_INTERNAL_SHARED_SECRET is required.");
	}
	const operatorHeaders = createOperatorHeaders({
		internalSharedSecret,
		operatorEmail: runtime.operatorEmail,
	});

	const baselineStartedAt = subtractHours(now, 26);
	const baselineHeartbeatAt = subtractHours(now, 25.5);
	const baselineFinishedAt = subtractHours(now, 25);
	const hotStartedAt = subtractHours(now, 8);
	const hotHeartbeatAt = subtractHours(now, 7.5);
	const hotFinishedAt = subtractHours(now, 7);
	const repairStartedAt = subtractHours(now, 1.5);
	const repairHeartbeatAt = subtractHours(now, 1.25);
	const repairFinishedAt = subtractHours(now, 1);

	const baselineRunId = await startRun({
		app,
		collectorToken: runtime.collectorToken,
		configVersion: "git:official-web-smoke-seed",
		crawlPolicyVersion: "2026-04-20-local-smoke",
		hostSet: [host],
		runIntent: "baseline",
		schedulerRunKey: `${baseSeedKey}:baseline`,
		seedSet: [`https://${host}/`],
		siteId,
		startedAt: baselineStartedAt,
		triggerType: "manual",
	});
	await postHeartbeat({
		app,
		collectorToken: runtime.collectorToken,
		counts: {
			artifactUploads: 2,
			failures: 0,
			pagesNormalized: 3,
			urlsDiscovered: 5,
			urlsFetched: 3,
		},
		observedAt: baselineHeartbeatAt,
		runId: baselineRunId,
		sequence: 1,
	});
	await finalizeRun({
		app,
		artifacts: [
			{
				artifactType: "crawl_run_manifest",
				contentSha256: `${baselineRunId}-manifest`,
				objectKey: `official_web/${siteId}/runs/${baselineRunId}/crawl-run.json`,
				recordCount: 1,
			},
			{
				artifactType: "source_truth_bundle",
				contentSha256: `${baselineRunId}-bundle`,
				objectKey: `official_web/${siteId}/runs/${baselineRunId}/source-truth.tar`,
				recordCount: 3,
			},
		],
		collectorToken: runtime.collectorToken,
		finishedAt: baselineFinishedAt,
		pageObservations: [
			{
				contentType: "text/html",
				discoveredFromUrl: null,
				discoveryMethod: "seed",
				disposition: "fetched",
				etag: `"${baselineRunId}-listing"`,
				finalUrl: `https://${host}/news/`,
				host,
				httpStatus: 200,
				lastModified: toHttpDate(baselineStartedAt),
				mainContentHash: `${baselineRunId}-listing-main-v1`,
				normalizedCanonicalUrl: `https://${host}/news/`,
				observedAt: baselineFinishedAt,
				pageFamily: "listing_page",
				pageTitleNormalized: "中央民族大学新闻网",
				rawAssetId: `${baselineRunId}-raw-listing`,
				rawVersionId: `${baselineRunId}-rawv-listing`,
				requestedUrl: `https://${host}/news/`,
				responseBodyHash: `${baselineRunId}-listing-body-v1`,
			},
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "fetched",
				etag: `"${baselineRunId}-detail-admissions"`,
				finalUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				host,
				httpStatus: 200,
				lastModified: toHttpDate(baselineStartedAt),
				mainContentHash: `${baselineRunId}-detail-admissions-v1`,
				normalizedCanonicalUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				observedAt: baselineFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "2026年本科招生简章",
				rawAssetId: `${baselineRunId}-raw-admissions`,
				rawVersionId: `${baselineRunId}-rawv-admissions`,
				requestedUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				responseBodyHash: `${baselineRunId}-detail-admissions-body-v1`,
			},
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "fetched",
				etag: `"${baselineRunId}-detail-library"`,
				finalUrl: `https://${host}/news/library-hours.htm`,
				host,
				httpStatus: 200,
				lastModified: toHttpDate(baselineStartedAt),
				mainContentHash: `${baselineRunId}-detail-library-v1`,
				normalizedCanonicalUrl: `https://${host}/news/library-hours.htm`,
				observedAt: baselineFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "图书馆开放时间调整通知",
				rawAssetId: `${baselineRunId}-raw-library`,
				rawVersionId: `${baselineRunId}-rawv-library`,
				requestedUrl: `https://${host}/news/library-hours.htm`,
				responseBodyHash: `${baselineRunId}-detail-library-body-v1`,
			},
		],
		runId: baselineRunId,
		summary: {
			failureCount: 0,
			pagesNormalized: 3,
			urlsDiscovered: 5,
			urlsFetched: 3,
		},
		terminalStatus: "completed",
	});

	const hotRunId = await startRun({
		app,
		collectorToken: runtime.collectorToken,
		configVersion: "git:official-web-smoke-seed",
		crawlPolicyVersion: "2026-04-20-local-smoke",
		hostSet: [host],
		runIntent: "hot",
		schedulerRunKey: `${baseSeedKey}:hot`,
		seedSet: [`https://${host}/news/`],
		siteId,
		startedAt: hotStartedAt,
		triggerType: "manual",
	});
	await postHeartbeat({
		app,
		collectorToken: runtime.collectorToken,
		counts: {
			artifactUploads: 1,
			failures: 0,
			pagesNormalized: 3,
			urlsDiscovered: 4,
			urlsFetched: 3,
		},
		observedAt: hotHeartbeatAt,
		runId: hotRunId,
		sequence: 1,
	});
	await finalizeRun({
		app,
		artifacts: [
			{
				artifactType: "page_observations",
				contentSha256: `${hotRunId}-page-observations`,
				objectKey: `official_web/${siteId}/runs/${hotRunId}/page-observations.jsonl`,
				recordCount: 3,
			},
		],
		collectorToken: runtime.collectorToken,
		finishedAt: hotFinishedAt,
		pageObservations: [
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "fetched",
				etag: `"${hotRunId}-detail-admissions"`,
				finalUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				host,
				httpStatus: 200,
				lastModified: toHttpDate(hotStartedAt),
				mainContentHash: `${hotRunId}-detail-admissions-v2`,
				normalizedCanonicalUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				observedAt: hotFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "2026年本科招生简章（更新）",
				rawAssetId: `${hotRunId}-raw-admissions`,
				rawVersionId: `${hotRunId}-rawv-admissions`,
				requestedUrl: `https://${host}/admissions/undergraduate-2026.htm`,
				responseBodyHash: `${hotRunId}-detail-admissions-body-v2`,
			},
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "not_modified",
				etag: `"${baselineRunId}-detail-library"`,
				finalUrl: `https://${host}/news/library-hours.htm`,
				host,
				httpStatus: 304,
				lastModified: toHttpDate(baselineStartedAt),
				mainContentHash: `${baselineRunId}-detail-library-v1`,
				normalizedCanonicalUrl: `https://${host}/news/library-hours.htm`,
				observedAt: hotFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "图书馆开放时间调整通知",
				rawAssetId: null,
				rawVersionId: null,
				requestedUrl: `https://${host}/news/library-hours.htm`,
				responseBodyHash: `${baselineRunId}-detail-library-body-v1`,
			},
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "fetched",
				etag: `"${hotRunId}-detail-international"`,
				finalUrl: `https://${host}/news/international-forum.htm`,
				host,
				httpStatus: 200,
				lastModified: toHttpDate(hotStartedAt),
				mainContentHash: `${hotRunId}-detail-international-v1`,
				normalizedCanonicalUrl: `https://${host}/news/international-forum.htm`,
				observedAt: hotFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "国际论坛报名通知",
				rawAssetId: `${hotRunId}-raw-international`,
				rawVersionId: `${hotRunId}-rawv-international`,
				requestedUrl: `https://${host}/news/international-forum.htm`,
				responseBodyHash: `${hotRunId}-detail-international-body-v1`,
			},
		],
		runId: hotRunId,
		summary: {
			failureCount: 0,
			pagesNormalized: 3,
			urlsDiscovered: 4,
			urlsFetched: 3,
		},
		terminalStatus: "completed",
	});

	const repairRunId = await startRun({
		app,
		collectorToken: runtime.collectorToken,
		configVersion: "git:official-web-smoke-seed",
		crawlPolicyVersion: "2026-04-20-local-smoke",
		hostSet: [host],
		runIntent: "repair",
		schedulerRunKey: `${baseSeedKey}:repair`,
		seedSet: [`https://${host}/news/`],
		siteId,
		startedAt: repairStartedAt,
		triggerType: "manual",
	});
	await postHeartbeat({
		app,
		collectorToken: runtime.collectorToken,
		counts: {
			artifactUploads: 1,
			failures: 1,
			pagesNormalized: 2,
			urlsDiscovered: 2,
			urlsFetched: 2,
		},
		observedAt: repairHeartbeatAt,
		runId: repairRunId,
		sequence: 1,
	});
	await finalizeRun({
		app,
		artifacts: [
			{
				artifactType: "failures",
				contentSha256: `${repairRunId}-failures`,
				objectKey: `official_web/${siteId}/runs/${repairRunId}/failures.jsonl`,
				recordCount: 1,
			},
		],
		collectorToken: runtime.collectorToken,
		finishedAt: repairFinishedAt,
		pageObservations: [
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "fetch_failed",
				etag: null,
				finalUrl: `https://${host}/news/faculty-award.htm`,
				host,
				httpStatus: 502,
				lastModified: null,
				mainContentHash: null,
				normalizedCanonicalUrl: `https://${host}/news/faculty-award.htm`,
				observedAt: repairFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "教师获奖公告",
				rawAssetId: null,
				rawVersionId: null,
				requestedUrl: `https://${host}/news/faculty-award.htm`,
				responseBodyHash: null,
			},
			{
				contentType: "text/html",
				discoveredFromUrl: `https://${host}/news/`,
				discoveryMethod: "listing_link",
				disposition: "deleted",
				etag: null,
				finalUrl: `https://${host}/news/archive/retired-announcement.htm`,
				host,
				httpStatus: 404,
				lastModified: null,
				mainContentHash: null,
				normalizedCanonicalUrl: `https://${host}/news/archive/retired-announcement.htm`,
				observedAt: repairFinishedAt,
				pageFamily: "article_detail",
				pageTitleNormalized: "已归档公告",
				rawAssetId: null,
				rawVersionId: null,
				requestedUrl: `https://${host}/news/archive/retired-announcement.htm`,
				responseBodyHash: null,
			},
		],
		runId: repairRunId,
		summary: {
			failureCount: 1,
			pagesNormalized: 2,
			urlsDiscovered: 2,
			urlsFetched: 2,
		},
		terminalStatus: "completed_with_errors",
	});

	const projector = buildOfficialWebProjectionProjector({
		handoffPublisher: {
			async publish(payload) {
				return {
					dispatchRef: `local-smoke-dispatch:${payload.runId}`,
				};
			},
		},
		store: createPgOfficialWebProjectionStore(runtime.env),
	});
	const projection = await projector.drain({
		limit: 20,
	});

	const siteResponse = await app.fetch(
		new Request(`https://app-api.internal/api/operator/official-web/sites/${siteId}`, {
			headers: operatorHeaders,
		}),
	);
	const sitePayload = await expectJsonResponse<{
		recentPageChanges: unknown[];
		recentRuns: Array<{ runId: string }>;
		site: {
			latestRunId: string | null;
			siteId: string;
		};
		freshnessSummary: {
			totalPages: number;
		};
	}>(siteResponse, 200);

	const runsResponse = await app.fetch(
		new Request(
			`https://app-api.internal/api/operator/official-web/runs?limit=20&siteId=${siteId}`,
			{
				headers: operatorHeaders,
			},
		),
	);
	const runsPayload = await expectJsonResponse<{
		page: {
			nextCursor: string | null;
		};
		runs: Array<{ runId: string }>;
	}>(runsResponse, 200);

	return {
		detailRunId: repairRunId,
		projection,
		runIds: [baselineRunId, hotRunId, repairRunId],
		runsPage: {
			nextCursor: runsPayload.page.nextCursor,
			runCount: runsPayload.runs.length,
		},
		site: {
			latestRunId: sitePayload.site.latestRunId,
			recentPageChanges: sitePayload.recentPageChanges.length,
			recentRuns: sitePayload.recentRuns.length,
			siteId: sitePayload.site.siteId,
			totalPages: sitePayload.freshnessSummary.totalPages,
		},
	};
}

async function main(argv: string[]): Promise<void> {
	const args = parseOfficialWebSmokeSeedArgs(argv);
	const runtime = buildLocalOfficialWebSmokeSeedRuntime(process.env);
	const result = await seedOfficialWebSmokeSamples({
		args,
		runtime,
	});
	console.log(JSON.stringify(result, null, 2));
}

const isEntrypoint =
	typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	void main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createOfficialWebControlPlaneClient,
	OfficialWebControlPlaneTransportError,
} from "../src/control-plane";

function readMockRequestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number): string {
	const body = fetchImplementation.mock.calls[index]?.[1]?.body;
	if (typeof body !== "string") {
		throw new Error(`Missing request body for call ${index}`);
	}
	return body;
}

describe("official-web control plane client", () => {
	it("sends start, heartbeat, and finalize requests using the frozen HTTP contract", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						run: {
							runId: "owrun_01JQTEST",
							siteId: "campus_public",
							status: "accepted",
							startedAt: "2026-03-29T08:00:01.000Z",
							heartbeatIntervalSeconds: 60,
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						plan: {
							duePages: [
								{
									cadenceClass: "listing_hot",
									contentType: "text/html",
									discoveredFromUrl: "https://www.example.edu/news/",
									discoveryMethod: "navigation",
									etag: '"etag-1"',
									host: "www.example.edu",
									lastChangeReason: "main_content_changed",
									lastChangedAt: "2026-03-29T07:30:00.000Z",
									lastFetchDisposition: "fetched",
									lastHttpStatus: 200,
									lastModified: "Sat, 29 Mar 2026 07:30:00 GMT",
									lastNotModifiedAt: null,
									lastSeenAt: "2026-03-29T07:30:00.000Z",
									lastSuccessfulRunId: "owrun_prev",
									mainContentHash: "main-prev",
									nextEligibleFetchAt: "2026-03-29T08:00:00.000Z",
									normalizedCanonicalUrl: "https://www.example.edu/news/",
									pageFamily: "listing_page",
									pageTitleNormalized: "News",
									priorityScore: 90,
									responseBodyHash: "body-prev",
									siteId: "campus_public",
								},
							],
							hostFilter: ["www.example.edu"],
							maxPagesPerHost: 20,
							maxTotalPages: 80,
							resolvedAt: "2026-03-29T08:00:01.000Z",
							runIntent: "baseline",
							siteId: "campus_public",
							summary: {
								duePages: 1,
								listingPages: 1,
								repairPages: 0,
								selectedHosts: 1,
								staticPages: 0,
							},
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						run: {
							runId: "owrun_01JQTEST",
							status: "running",
							lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						run: {
							runId: "owrun_01JQTEST",
							status: "completed_with_errors",
							ingestionDispatchStatus: "queued",
							finishedAt: "2026-03-29T08:17:32.000Z",
						},
					}),
					{ status: 200 },
				),
			);

		const client = createOfficialWebControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{ fetchImplementation },
		);

		const started = await client.startRun({
			siteId: "campus_public",
			schedulerRunKey: "cron-2026-03-29T08:00:00Z",
			runIntent: "baseline",
			triggerType: "scheduled",
			collectorVersion: "official-web-collector@0.1.0",
			configVersion: "git:abc1234",
			crawlPolicyVersion: "2026-03-29",
			hostSet: ["www.example.edu"],
			seedSet: ["https://www.example.edu/"],
			startedAt: "2026-03-29T08:00:01.000Z",
			traceId: "trace_01JQ",
		});
		const resolvedPlan = await client.resolvePlan({
			hostFilter: ["www.example.edu"],
			maxPagesPerHost: 20,
			maxTotalPages: 80,
			now: "2026-03-29T08:00:01.000Z",
			runIntent: "baseline",
			siteId: "campus_public",
			targetCandidateIds: ["owcand_target"],
			traceId: "trace_01JQ",
		});
		const heartbeat = await client.sendHeartbeat({
			runId: started.run.runId,
			sequence: 3,
			observedAt: "2026-03-29T08:05:00.000Z",
			counts: {
				urlsDiscovered: 280,
				urlsFetched: 220,
				pagesNormalized: 180,
				artifactUploads: 6,
				failures: 4,
			},
			traceId: "trace_01JQ",
		});
		const finalized = await client.finalizeRun({
			runId: started.run.runId,
			terminalStatus: "completed_with_errors",
			finishedAt: "2026-03-29T08:17:32.000Z",
			pageObservations: [
				{
					schemaVersion: "official_web_page_observation.v1",
					observedAt: "2026-03-29T08:17:32.000Z",
					siteId: "campus_public",
					crawlRunId: "owrun_01JQTEST",
					runIntent: "baseline",
					rawAssetId: "raw_01",
					rawVersionId: "rawv_01",
					host: "www.example.edu",
					requestedUrl: "https://www.example.edu/admissions",
					finalUrl: "https://www.example.edu/admissions",
					normalizedCanonicalUrl: "https://www.example.edu/admissions",
					pageFamily: "article_detail",
					pageTitleNormalized: "Admissions",
					discoveryMethod: "seed",
					discoveredFromUrl: null,
					httpStatus: 200,
					contentType: "text/html",
					etag: null,
					lastModified: null,
					responseBodyHash: "body-1",
					mainContentHash: "main-1",
					disposition: "fetched",
				},
			],
			summary: {
				urlsDiscovered: 420,
				urlsFetched: 390,
				pagesNormalized: 310,
				rawAssetsObserved: 310,
				failureCount: 12,
			},
			artifacts: [
				{
					artifactType: "crawl_run_manifest",
					objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
					contentSha256: "abc123",
					recordCount: 1,
				},
			],
			traceId: "trace_01JQ",
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(4);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://app-api.internal/api/official-web/runs",
			expect.objectContaining({
				method: "POST",
				headers: {
					authorization: "Bearer service-token",
					"content-type": "application/json",
					"x-trace-id": "trace_01JQ",
				},
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			siteId: "campus_public",
			schedulerRunKey: "cron-2026-03-29T08:00:00Z",
			runIntent: "baseline",
			triggerType: "scheduled",
			collectorVersion: "official-web-collector@0.1.0",
			configVersion: "git:abc1234",
			crawlPolicyVersion: "2026-03-29",
			hostSet: ["www.example.edu"],
			seedSet: ["https://www.example.edu/"],
			startedAt: "2026-03-29T08:00:01.000Z",
		});
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://app-api.internal/api/official-web/plans:resolve",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 1))).toEqual({
			hostFilter: ["www.example.edu"],
			maxPagesPerHost: 20,
			maxTotalPages: 80,
			now: "2026-03-29T08:00:01.000Z",
			runIntent: "baseline",
			siteId: "campus_public",
			targetCandidateIds: ["owcand_target"],
		});
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			3,
			"https://app-api.internal/api/official-web/runs/owrun_01JQTEST/heartbeats",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 2))).toEqual({
			sequence: 3,
			observedAt: "2026-03-29T08:05:00.000Z",
			counts: {
				urlsDiscovered: 280,
				urlsFetched: 220,
				pagesNormalized: 180,
				artifactUploads: 6,
				failures: 4,
			},
		});
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			4,
			"https://app-api.internal/api/official-web/runs/owrun_01JQTEST/finalize",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 3))).toEqual({
			terminalStatus: "completed_with_errors",
			finishedAt: "2026-03-29T08:17:32.000Z",
			pageObservations: [
				{
					schemaVersion: "official_web_page_observation.v1",
					observedAt: "2026-03-29T08:17:32.000Z",
					siteId: "campus_public",
					crawlRunId: "owrun_01JQTEST",
					runIntent: "baseline",
					rawAssetId: "raw_01",
					rawVersionId: "rawv_01",
					host: "www.example.edu",
					requestedUrl: "https://www.example.edu/admissions",
					finalUrl: "https://www.example.edu/admissions",
					normalizedCanonicalUrl: "https://www.example.edu/admissions",
					pageFamily: "article_detail",
					pageTitleNormalized: "Admissions",
					discoveryMethod: "seed",
					discoveredFromUrl: null,
					httpStatus: 200,
					contentType: "text/html",
					etag: null,
					lastModified: null,
					responseBodyHash: "body-1",
					mainContentHash: "main-1",
					disposition: "fetched",
				},
			],
			summary: {
				urlsDiscovered: 420,
				urlsFetched: 390,
				pagesNormalized: 310,
				rawAssetsObserved: 310,
				failureCount: 12,
			},
			artifacts: [
				{
					artifactType: "crawl_run_manifest",
					objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
					contentSha256: "abc123",
					recordCount: 1,
				},
			],
		});
		expect(started.run.status).toBe("accepted");
		expect(heartbeat.run.status).toBe("running");
		expect(resolvedPlan.plan.summary.duePages).toBe(1);
		expect(finalized.run.ingestionDispatchStatus).toBe("queued");
	});

	it("raises a typed transport error for non-200 responses", async () => {
		const client = createOfficialWebControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							error: {
								code: "idempotency_conflict",
								message: "Payload fingerprint differs.",
								retryable: false,
							},
						}),
						{ status: 409 },
					),
				),
			},
		);

		await expect(
			client.startRun({
				siteId: "campus_public",
				schedulerRunKey: "cron-2026-03-29T08:00:00Z",
				runIntent: "baseline",
				triggerType: "scheduled",
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.example.edu"],
				seedSet: ["https://www.example.edu/"],
				startedAt: "2026-03-29T08:00:01.000Z",
			}),
		).rejects.toBeInstanceOf(OfficialWebControlPlaneTransportError);
	});

	it("fails closed when control-plane error payload misses the typed error contract", async () => {
		const client = createOfficialWebControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							error: {
								message: "Payload fingerprint differs.",
							},
						}),
						{ status: 409 },
					),
				),
			},
		);

		await expect(
			client.startRun({
				siteId: "campus_public",
				schedulerRunKey: "cron-2026-03-29T08:00:00Z",
				runIntent: "baseline",
				triggerType: "scheduled",
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.example.edu"],
				seedSet: ["https://www.example.edu/"],
				startedAt: "2026-03-29T08:00:01.000Z",
			}),
		).rejects.toMatchObject({
			code: "app_api_invalid_error_envelope",
			retryable: false,
			status: 409,
		});
	});

	it("fails closed when control-plane returns a non-JSON error payload", async () => {
		const client = createOfficialWebControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("<html>bad gateway</html>", {
						status: 502,
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
					}),
				),
			},
		);

		await expect(
			client.startRun({
				siteId: "campus_public",
				schedulerRunKey: "cron-2026-03-29T08:00:00Z",
				runIntent: "baseline",
				triggerType: "scheduled",
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.example.edu"],
				seedSet: ["https://www.example.edu/"],
				startedAt: "2026-03-29T08:00:01.000Z",
			}),
		).rejects.toMatchObject({
			code: "app_api_invalid_json",
			status: 502,
		});
	});

	it("fails closed when control-plane returns a non-JSON success payload", async () => {
		const client = createOfficialWebControlPlaneClient(
			{
				appApiBaseUrl: "https://app-api.internal",
				serviceToken: "service-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("ok", {
						status: 200,
						headers: {
							"content-type": "text/plain; charset=utf-8",
						},
					}),
				),
			},
		);

		await expect(
			client.startRun({
				siteId: "campus_public",
				schedulerRunKey: "cron-2026-03-29T08:00:00Z",
				runIntent: "baseline",
				triggerType: "scheduled",
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.example.edu"],
				seedSet: ["https://www.example.edu/"],
				startedAt: "2026-03-29T08:00:01.000Z",
			}),
		).rejects.toMatchObject({
			code: "app_api_invalid_json",
			status: 200,
		});
	});
});

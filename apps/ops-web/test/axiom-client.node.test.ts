// @vitest-environment node

import type { TabularQueryResult } from "@axiomhq/js";
import { describe, expect, it, vi } from "vitest";
import {
	type AxiomSdkQueryClient,
	AxiomUnavailableError,
	buildAxiomRequestApl,
	createAxiomClient,
	createAxiomClientFromEnv,
} from "../src/server/axiom-client";

const queryConfig = {
	edgeDomain: "eu-central-1.aws.edge.axiom.co",
	logsDataset: "campus-agent-runtime",
	queryToken: "xaat-query-token",
};

const requestQuery = {
	completedAt: "2026-07-09T06:29:04.000Z",
	kind: "logs" as const,
	now: new Date("2026-07-09T06:30:00.000Z"),
	requestId: "req_ops_001",
	startedAt: "2026-07-09T06:29:00.000Z",
};

describe("Axiom client", () => {
	it("queries only the fixed logs dataset by the stored request ID", async () => {
		const sdkClient = fakeSdk([
			{
				durationMs: 125,
				errorCode: "provider_timeout",
				eventType: "request.finalized",
				requestId: "req_ops_001",
				serviceName: "app-api",
				severityText: "ERROR",
				source: "app-api.runtime",
				status: "error",
				timestamp: "2026-07-09T06:29:04.000Z",
			},
		]);
		const client = createAxiomClient({ ...queryConfig, sdkClient });

		const result = await client.queryRequest(requestQuery);

		expect(result).toMatchObject({
			kind: "logs",
			limit: 200,
			records: [
				expect.objectContaining({
					eventType: "request.finalized",
					requestId: "req_ops_001",
				}),
			],
			requestId: "req_ops_001",
			source: "AXIOM",
			truncated: false,
		});
		const [apl, options] = vi.mocked(sdkClient.query).mock.calls[0] ?? [];
		expect(options).toEqual({
			endTime: "2026-07-09T06:30:00.000Z",
			format: "tabular",
			startTime: "2026-07-09T06:24:00.000Z",
		});
		expect(apl).toContain("['campus-agent-runtime']");
		const whereClause = String(apl)
			.split("\n")
			.find((line) => line.startsWith("| where"));
		expect(whereClause).toContain("['attributes.custom']['campus.request_id']");
		expect(whereClause).not.toContain("body[");
		expect(apl).toContain("severityText = tostring(severity_text)");
		expect(apl).not.toContain("severityText, severity");
		expect(apl).not.toContain("coalesce(");
		expect(whereClause).not.toContain("campus.trace_id");
		expect(apl).not.toContain("campus.trace_id");
		expect(apl).not.toContain("otelTraceId");
		expect(apl).not.toContain("otelSpanId");
		expect(apl).toContain("errorCode = tostring(['attributes.custom']['error_code'])");
		expect(apl).not.toContain("['attributes.custom']['error.code']");
		expect(apl).toContain("| take 201");
	});

	it("caps log records and marks bounded results as truncated", async () => {
		const records = Array.from({ length: 201 }, (_, index) => ({
			requestId: "req_ops_001",
			timestamp: new Date(Date.UTC(2026, 6, 9, 6, 29, 0, index)).toISOString(),
		}));
		const client = createAxiomClient({
			...queryConfig,
			sdkClient: fakeSdk(records, { rowsMatched: records.length }),
		});

		const result = await client.queryRequest(requestQuery);

		expect(result.records).toHaveLength(200);
		expect(result.truncated).toBe(true);
	});

	it("limits request queries to the most recent thirty minutes", async () => {
		const client = createAxiomClient({ ...queryConfig, sdkClient: fakeSdk([]) });
		const result = await client.queryRequest({
			...requestQuery,
			completedAt: "2026-07-09T06:30:00.000Z",
			startedAt: "2026-07-09T04:00:00.000Z",
		});

		expect(Date.parse(result.to) - Date.parse(result.from)).toBe(30 * 60_000);
		expect(result.truncated).toBe(true);
	});

	it("normalizes numeric Axiom timestamps", async () => {
		const client = createAxiomClient({
			...queryConfig,
			sdkClient: fakeSdk([
				{
					requestId: "req_ops_001",
					timestamp: 1_783_578_544_200_000_000,
				},
			]),
		});

		const result = await client.queryRequest(requestQuery);

		expect(result.records[0]?.timestamp).toBe("2026-07-09T06:29:04.200Z");
	});

	it("rejects partial results, SDK failures, and pre-aborted callers", async () => {
		const partial = createAxiomClient({
			...queryConfig,
			sdkClient: fakeSdk([], { isPartial: true }),
		});
		await expect(partial.queryRequest(requestQuery)).rejects.toThrow(AxiomUnavailableError);

		const failed = createAxiomClient({
			...queryConfig,
			sdkClient: { query: vi.fn().mockRejectedValue(new Error("rate limited")) },
		});
		await expect(failed.queryRequest(requestQuery)).rejects.toThrow(AxiomUnavailableError);

		const sdkClient = fakeSdk([]);
		const aborted = createAxiomClient({ ...queryConfig, sdkClient });
		const controller = new AbortController();
		controller.abort(new Error("request closed"));
		await expect(
			aborted.queryRequest({ ...requestQuery, signal: controller.signal }),
		).rejects.toThrow(AxiomUnavailableError);
		expect(sdkClient.query).not.toHaveBeenCalled();
	});

	it("keeps an aborted SDK request in its bounded slot until the SDK settles", async () => {
		const pendingQueries: Deferred<TabularQueryResult>[] = [];
		const sdkClient: AxiomSdkQueryClient = {
			query: vi.fn(() => {
				const pending = deferred<TabularQueryResult>();
				pendingQueries.push(pending);
				return pending.promise;
			}) as AxiomSdkQueryClient["query"],
		};
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		const controllers = Array.from({ length: 5 }, () => new AbortController());
		const requests = controllers.map((controller, index) =>
			client.queryRequest({
				...requestQuery,
				requestId: `req_ops_00${index + 1}`,
				signal: controller.signal,
			}),
		);
		await vi.waitFor(() => expect(sdkClient.query).toHaveBeenCalledTimes(5));
		for (const controller of controllers) {
			controller.abort(new Error("request closed"));
		}
		await Promise.all(
			requests.map((request) => expect(request).rejects.toThrow(AxiomUnavailableError)),
		);

		await expect(
			client.queryRequest({
				...requestQuery,
				requestId: "req_ops_blocked",
			}),
		).rejects.toThrow("concurrency limit");

		for (const pending of pendingQueries) {
			pending.resolve(tabularResult([]));
		}
	});

	it("rejects query injection and personal-token surfaces", () => {
		expect(() =>
			createAxiomClient({
				...queryConfig,
				logsDataset: "logs'] | take 1000 //",
				sdkClient: fakeSdk([]),
			}),
		).toThrow("Axiom dataset name is invalid");
		expect(() =>
			createAxiomClient({
				...queryConfig,
				queryToken: "xapt-personal-token",
				sdkClient: fakeSdk([]),
			}),
		).toThrow("personal tokens are not allowed");
		expect(() =>
			buildAxiomRequestApl({
				dataset: "campus-agent-runtime",
				limit: 201,
				requestId: 'req" | take 1000',
			}),
		).toThrow("Axiom request ID is invalid");
	});

	it("requires only the fixed logs query environment", () => {
		expect(() => createAxiomClientFromEnv({})).toThrow("AXIOM_QUERY_TOKEN");
		expect(() =>
			createAxiomClientFromEnv({
				AXIOM_QUERY_TOKEN: "xaat-query-token",
				OPS_WEB_AXIOM_EDGE_DOMAIN: "https://eu-central-1.aws.edge.axiom.co",
				OPS_WEB_AXIOM_LOGS_DATASET: "campus-agent-runtime",
			}),
		).toThrow("Axiom Edge domain is invalid");
	});
});

function fakeSdk(
	records: Record<string, unknown>[],
	status: { isPartial?: boolean; rowsMatched?: number } = {},
): AxiomSdkQueryClient {
	return {
		query: vi.fn(async () => tabularResult(records, status)),
	};
}

function tabularResult(
	records: Record<string, unknown>[],
	status: { isPartial?: boolean; rowsMatched?: number } = {},
): TabularQueryResult {
	return {
		datasetNames: ["fixture"],
		fieldsMetaMap: {},
		format: "tabular",
		status: {
			blocksExamined: 2,
			elapsedTime: 7,
			isPartial: status.isPartial ?? false,
			maxBlockTime: "2026-07-09T06:30:00.000Z",
			maxCursor: "max",
			minBlockTime: "2026-07-09T06:29:00.000Z",
			minCursor: "min",
			numGroups: 0,
			rowsExamined: records.length,
			rowsMatched: status.rowsMatched ?? records.length,
		},
		tables: [
			{
				columns: [],
				events: function* () {
					for (const record of records) {
						yield record;
					}
				},
				fields: [],
				groups: [],
				name: "fixture",
				order: [],
				sources: [{ name: "fixture" }],
			},
		],
	} as TabularQueryResult;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

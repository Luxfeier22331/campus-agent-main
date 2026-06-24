import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { Client, type ClientConfig } from "pg";

import { buildOperatorDatabaseConfig } from "../src/db/runtime";
import {
	type ChatDurableE2eResult,
	runChatDurableE2eStaging as defaultRunChatDurableE2eStaging,
} from "./chat-durable-e2e-staging";

const DEFAULT_METRICS_WINDOW_MINUTES = 60;
const APP_API_DB_CONFIG_ID = "c697741c51ca42eb912cdb3e013728f3";
const APP_API_DB_FRESH_CONFIG_ID = "bcb527f5de2d4de49b2be59fac991838";
const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

export interface RuntimeDbProofArgs {
	chatArgs: string[];
	metricsWindowMinutes: number;
	outputPath: string | null;
}

export interface PostgresRuntimeSnapshot {
	requestExecutionCount: number;
	requestObservabilityFactCount: number;
	temporalTaskQueueSnapshotCount: number;
	traceBacklinkProjectionCount: number;
	workerAutoscalerDecisionCount: number;
}

export interface PostgresProjectionProof {
	observabilityFact: {
		modelExecutionState: string | null;
		modelName: string | null;
		modelProvider: string | null;
		status: string;
		traceAvailable: boolean;
		traceId: string;
	} | null;
	requestExecution: {
		runId: string | null;
		status: string;
		traceId: string;
	} | null;
	requestId: string;
	traceBacklink: {
		configured: boolean;
		found: boolean;
		traceLink: string | null;
	};
	traceId: string;
}

export interface HyperdriveLaneUsage {
	cacheStatusCounts: Record<string, number>;
	configId: string;
	eventStatusCounts: Record<string, number>;
	queryCount: number;
}

export interface HyperdriveUsageSnapshot {
	cached: HyperdriveLaneUsage;
	fresh: HyperdriveLaneUsage;
	pool: {
		maxCurrentPoolSize: number;
		maxWaitingClients: number;
	};
	windowMinutes: number;
}

export interface StagingRuntimeDbProofResult {
	chat: ChatDurableE2eResult;
	checks: {
		chatCompleted: boolean;
		hyperdriveUsageCollected: boolean;
		postgresProjectionFound: boolean;
		traceBacklinkSatisfied: boolean;
	};
	hyperdrive: {
		after: HyperdriveUsageSnapshot;
		before: HyperdriveUsageSnapshot;
		delta: {
			cachedQueryCount: number;
			freshQueryCount: number;
			maxCurrentPoolSize: number;
			maxWaitingClients: number;
		};
	};
	passed: boolean;
	postgres: {
		after: PostgresRuntimeSnapshot;
		before: PostgresRuntimeSnapshot;
		delta: PostgresRuntimeSnapshot;
		projection: PostgresProjectionProof;
	};
}

export interface StagingRuntimeDbProofDependencies {
	collectHyperdriveUsage?: (
		input: Pick<RuntimeDbProofArgs, "metricsWindowMinutes">,
		env: NodeJS.ProcessEnv,
	) => Promise<HyperdriveUsageSnapshot>;
	collectPostgresProjectionProof?: (
		input: {
			requestId: string;
			traceId: string;
		},
		env: NodeJS.ProcessEnv,
	) => Promise<PostgresProjectionProof>;
	collectPostgresSnapshot?: (env: NodeJS.ProcessEnv) => Promise<PostgresRuntimeSnapshot>;
	runChatDurableE2eStaging?: (
		argv: string[],
		env: NodeJS.ProcessEnv,
	) => Promise<ChatDurableE2eResult>;
}

interface CloudflareGraphQlResponse {
	data?: {
		viewer?: {
			accounts?: Array<{
				hyperdrivePoolSizesAdaptiveGroups?: HyperdrivePoolGroup[];
				hyperdriveQueriesAdaptiveGroups?: HyperdriveQueryGroup[];
			}>;
		};
	};
	errors?: Array<{ message?: string }>;
}

interface HyperdriveQueryGroup {
	count?: number;
	dimensions?: {
		cacheStatus?: string;
		configId?: string;
		eventStatus?: string;
	};
}

interface HyperdrivePoolGroup {
	max?: {
		currentPoolSize?: number;
		waitingClients?: number;
	};
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parsePositiveInteger(value: string, label: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

export function parseStagingRuntimeDbProofArgs(argv: string[]): RuntimeDbProofArgs {
	const chatArgs: string[] = [];
	let metricsWindowMinutes = DEFAULT_METRICS_WINDOW_MINUTES;
	let outputPath: string | null = null;

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--metrics-window-minutes") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--metrics-window-minutes requires a non-empty value.");
			}
			metricsWindowMinutes = parsePositiveInteger(value, "--metrics-window-minutes");
			index += 1;
			continue;
		}
		if (token === "--output") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--output requires a non-empty value.");
			}
			outputPath = value;
			index += 1;
			continue;
		}
		chatArgs.push(token);
		if (token.startsWith("--")) {
			const maybeValue = argv[index + 1];
			if (maybeValue && maybeValue !== "--" && !maybeValue.startsWith("--")) {
				chatArgs.push(maybeValue);
				index += 1;
			}
		}
	}

	return {
		chatArgs,
		metricsWindowMinutes,
		outputPath,
	};
}

function countDelta(after: number, before: number): number {
	return Math.max(0, after - before);
}

function diffPostgresSnapshots(
	before: PostgresRuntimeSnapshot,
	after: PostgresRuntimeSnapshot,
): PostgresRuntimeSnapshot {
	return {
		requestExecutionCount: countDelta(after.requestExecutionCount, before.requestExecutionCount),
		requestObservabilityFactCount: countDelta(
			after.requestObservabilityFactCount,
			before.requestObservabilityFactCount,
		),
		temporalTaskQueueSnapshotCount: countDelta(
			after.temporalTaskQueueSnapshotCount,
			before.temporalTaskQueueSnapshotCount,
		),
		traceBacklinkProjectionCount: countDelta(
			after.traceBacklinkProjectionCount,
			before.traceBacklinkProjectionCount,
		),
		workerAutoscalerDecisionCount: countDelta(
			after.workerAutoscalerDecisionCount,
			before.workerAutoscalerDecisionCount,
		),
	};
}

function emptyLane(configId: string): HyperdriveLaneUsage {
	return {
		cacheStatusCounts: {},
		configId,
		eventStatusCounts: {},
		queryCount: 0,
	};
}

function incrementCounter(target: Record<string, number>, key: string, count: number): void {
	const normalizedKey = key.trim() || "unknown";
	target[normalizedKey] = (target[normalizedKey] ?? 0) + count;
}

function addQueryGroupToLane(lane: HyperdriveLaneUsage, group: HyperdriveQueryGroup): void {
	const count = typeof group.count === "number" ? group.count : 0;
	lane.queryCount += count;
	incrementCounter(lane.cacheStatusCounts, group.dimensions?.cacheStatus ?? "unknown", count);
	incrementCounter(lane.eventStatusCounts, group.dimensions?.eventStatus ?? "unknown", count);
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
	const value = normalizeOptionalValue(env[name]);
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function windowStartIso(windowMinutes: number): string {
	return new Date(Date.now() - windowMinutes * 60_000).toISOString();
}

async function fetchCloudflareGraphQl(
	query: string,
	variables: Record<string, unknown>,
	env: NodeJS.ProcessEnv,
): Promise<CloudflareGraphQlResponse> {
	const token = requireEnv("CLOUDFLARE_API_TOKEN", env);
	const response = await fetch(CLOUDFLARE_GRAPHQL_URL, {
		body: JSON.stringify({
			query,
			variables,
		}),
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		method: "POST",
		signal: AbortSignal.timeout(30_000),
	});
	const payload = (await response.json()) as CloudflareGraphQlResponse;
	if (!response.ok) {
		throw new Error(`Cloudflare GraphQL failed (${response.status}): ${JSON.stringify(payload)}`);
	}
	if ((payload.errors?.length ?? 0) > 0) {
		throw new Error(`Cloudflare GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
	}
	return payload;
}

export async function collectHyperdriveUsage(
	input: Pick<RuntimeDbProofArgs, "metricsWindowMinutes">,
	env: NodeJS.ProcessEnv = process.env,
): Promise<HyperdriveUsageSnapshot> {
	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID", env);
	const since = windowStartIso(input.metricsWindowMinutes);
	const response = await fetchCloudflareGraphQl(
		`query CampusAgentHyperdriveUsage($accountId: String!, $since: Time!, $configIds: [string!]) {
			viewer {
				accounts(filter: { accountTag: $accountId }) {
					hyperdriveQueriesAdaptiveGroups(
						filter: { datetimeHour_geq: $since, configId_in: $configIds }
						limit: 1000
					) {
						count
						dimensions {
							cacheStatus
							configId
							eventStatus
						}
					}
					hyperdrivePoolSizesAdaptiveGroups(
						filter: { datetimeHour_geq: $since, configId_in: $configIds }
						limit: 1000
					) {
						max {
							currentPoolSize
							waitingClients
						}
					}
				}
			}
		}`,
		{
			accountId,
			configIds: [APP_API_DB_CONFIG_ID, APP_API_DB_FRESH_CONFIG_ID],
			since,
		},
		env,
	);
	const account = response.data?.viewer?.accounts?.[0];
	if (!account) {
		throw new Error("Cloudflare GraphQL did not return the configured account.");
	}

	const snapshot: HyperdriveUsageSnapshot = {
		cached: emptyLane(APP_API_DB_CONFIG_ID),
		fresh: emptyLane(APP_API_DB_FRESH_CONFIG_ID),
		pool: {
			maxCurrentPoolSize: 0,
			maxWaitingClients: 0,
		},
		windowMinutes: input.metricsWindowMinutes,
	};

	for (const group of account.hyperdriveQueriesAdaptiveGroups ?? []) {
		if (group.dimensions?.configId === APP_API_DB_CONFIG_ID) {
			addQueryGroupToLane(snapshot.cached, group);
			continue;
		}
		if (group.dimensions?.configId === APP_API_DB_FRESH_CONFIG_ID) {
			addQueryGroupToLane(snapshot.fresh, group);
		}
	}

	for (const group of account.hyperdrivePoolSizesAdaptiveGroups ?? []) {
		snapshot.pool.maxCurrentPoolSize = Math.max(
			snapshot.pool.maxCurrentPoolSize,
			group.max?.currentPoolSize ?? 0,
		);
		snapshot.pool.maxWaitingClients = Math.max(
			snapshot.pool.maxWaitingClients,
			group.max?.waitingClients ?? 0,
		);
	}

	return snapshot;
}

async function withOperatorClient<T>(
	env: NodeJS.ProcessEnv,
	callback: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client(buildOperatorDatabaseConfig(env) as ClientConfig);
	await client.connect();
	try {
		return await callback(client);
	} finally {
		await client.end();
	}
}

async function queryCount(client: Client, sql: string): Promise<number> {
	const result = await client.query<{ count: string }>(sql);
	return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function collectPostgresSnapshot(
	env: NodeJS.ProcessEnv = process.env,
): Promise<PostgresRuntimeSnapshot> {
	return withOperatorClient(env, async (client) => ({
		requestExecutionCount: await queryCount(
			client,
			'select count(*)::text as count from "runtime"."request_execution"',
		),
		requestObservabilityFactCount: await queryCount(
			client,
			'select count(*)::text as count from "runtime"."request_observability_fact"',
		),
		temporalTaskQueueSnapshotCount: await queryCount(
			client,
			'select count(*)::text as count from "operator"."temporal_task_queue_snapshot"',
		),
		traceBacklinkProjectionCount: await queryCount(
			client,
			'select count(*)::text as count from "operator"."trace_backlink_projection"',
		),
		workerAutoscalerDecisionCount: await queryCount(
			client,
			'select count(*)::text as count from "operator"."worker_autoscaler_decision"',
		),
	}));
}

function traceBacklinkConfigured(env: NodeJS.ProcessEnv): boolean {
	return Boolean(normalizeOptionalValue(env.APP_API_OPERATOR_TRACE_LINK_TEMPLATE));
}

export async function collectPostgresProjectionProof(
	input: {
		requestId: string;
		traceId: string;
	},
	env: NodeJS.ProcessEnv = process.env,
): Promise<PostgresProjectionProof> {
	return withOperatorClient(env, async (client) => {
		const execution = await client.query<{
			run_id: string | null;
			status: string;
			trace_id: string;
		}>(
			'select "run_id", "status", "trace_id" from "runtime"."request_execution" where "request_id" = $1',
			[input.requestId],
		);
		const observability = await client.query<{
			model_execution_state: string | null;
			model_name: string | null;
			model_provider: string | null;
			status: string;
			trace_available: boolean;
			trace_id: string;
		}>(
			`select
				"model_execution_state",
				"model_name",
				"model_provider",
				"status",
				"trace_available",
				"trace_id"
			from "runtime"."request_observability_fact"
			where "request_id" = $1`,
			[input.requestId],
		);
		const backlink = await client.query<{ trace_link: string | null }>(
			'select "trace_link" from "operator"."trace_backlink_projection" where "request_id" = $1',
			[input.requestId],
		);
		const traceBacklinkFound = backlink.rows.length > 0;

		return {
			observabilityFact: observability.rows[0]
				? {
						modelExecutionState: observability.rows[0].model_execution_state,
						modelName: observability.rows[0].model_name,
						modelProvider: observability.rows[0].model_provider,
						status: observability.rows[0].status,
						traceAvailable: observability.rows[0].trace_available,
						traceId: observability.rows[0].trace_id,
					}
				: null,
			requestExecution: execution.rows[0]
				? {
						runId: execution.rows[0].run_id,
						status: execution.rows[0].status,
						traceId: execution.rows[0].trace_id,
					}
				: null,
			requestId: input.requestId,
			traceBacklink: {
				configured: traceBacklinkConfigured(env),
				found: traceBacklinkFound,
				traceLink: backlink.rows[0]?.trace_link ?? null,
			},
			traceId: input.traceId,
		};
	});
}

function hyperdriveDelta(before: HyperdriveUsageSnapshot, after: HyperdriveUsageSnapshot) {
	return {
		cachedQueryCount: countDelta(after.cached.queryCount, before.cached.queryCount),
		freshQueryCount: countDelta(after.fresh.queryCount, before.fresh.queryCount),
		maxCurrentPoolSize: Math.max(before.pool.maxCurrentPoolSize, after.pool.maxCurrentPoolSize),
		maxWaitingClients: Math.max(before.pool.maxWaitingClients, after.pool.maxWaitingClients),
	};
}

function readCompletedChatIdentity(chat: ChatDurableE2eResult): {
	requestId: string;
	traceId: string;
} {
	const requestId = chat.run?.requestId ?? chat.submit?.requestId ?? "";
	const traceId = chat.run?.traceId ?? chat.submit?.traceId ?? "";
	if (!(requestId && traceId)) {
		throw new Error("Durable chat result must include requestId and traceId.");
	}
	return {
		requestId,
		traceId,
	};
}

export async function runStagingRuntimeDbProof(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: StagingRuntimeDbProofDependencies = {},
): Promise<StagingRuntimeDbProofResult> {
	const args = parseStagingRuntimeDbProofArgs(argv);
	const resolvedDeps = {
		collectHyperdriveUsage: deps.collectHyperdriveUsage ?? collectHyperdriveUsage,
		collectPostgresProjectionProof:
			deps.collectPostgresProjectionProof ?? collectPostgresProjectionProof,
		collectPostgresSnapshot: deps.collectPostgresSnapshot ?? collectPostgresSnapshot,
		runChatDurableE2eStaging: deps.runChatDurableE2eStaging ?? defaultRunChatDurableE2eStaging,
	};

	const [postgresBefore, hyperdriveBefore] = await Promise.all([
		resolvedDeps.collectPostgresSnapshot(env),
		resolvedDeps.collectHyperdriveUsage(
			{
				metricsWindowMinutes: args.metricsWindowMinutes,
			},
			env,
		),
	]);
	const chat = await resolvedDeps.runChatDurableE2eStaging(args.chatArgs, env);
	const identity = readCompletedChatIdentity(chat);
	const [postgresAfter, hyperdriveAfter, projection] = await Promise.all([
		resolvedDeps.collectPostgresSnapshot(env),
		resolvedDeps.collectHyperdriveUsage(
			{
				metricsWindowMinutes: args.metricsWindowMinutes,
			},
			env,
		),
		resolvedDeps.collectPostgresProjectionProof(identity, env),
	]);

	const postgresProjectionFound = Boolean(
		projection.requestExecution &&
			projection.observabilityFact &&
			projection.requestExecution.traceId === identity.traceId &&
			projection.observabilityFact.traceId === identity.traceId,
	);
	const traceBacklinkSatisfied =
		!projection.traceBacklink.configured || projection.traceBacklink.found;
	const checks = {
		chatCompleted: chat.passed && chat.run?.status === "completed",
		hyperdriveUsageCollected:
			hyperdriveBefore.cached.configId === APP_API_DB_CONFIG_ID &&
			hyperdriveBefore.fresh.configId === APP_API_DB_FRESH_CONFIG_ID &&
			hyperdriveAfter.cached.configId === APP_API_DB_CONFIG_ID &&
			hyperdriveAfter.fresh.configId === APP_API_DB_FRESH_CONFIG_ID,
		postgresProjectionFound,
		traceBacklinkSatisfied,
	};

	return {
		chat,
		checks,
		hyperdrive: {
			after: hyperdriveAfter,
			before: hyperdriveBefore,
			delta: hyperdriveDelta(hyperdriveBefore, hyperdriveAfter),
		},
		passed: Object.values(checks).every(Boolean),
		postgres: {
			after: postgresAfter,
			before: postgresBefore,
			delta: diffPostgresSnapshots(postgresBefore, postgresAfter),
			projection,
		},
	};
}

async function writeJsonEvidence(
	outputPath: string,
	result: StagingRuntimeDbProofResult,
): Promise<void> {
	await mkdir(dirname(outputPath), {
		recursive: true,
	});
	await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function main(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: StagingRuntimeDbProofDependencies = {},
) {
	const args = parseStagingRuntimeDbProofArgs(argv);
	const result = await runStagingRuntimeDbProof(argv, env, deps);
	const output = JSON.stringify(result, null, 2);
	if (args.outputPath) {
		await writeJsonEvidence(args.outputPath, result);
	}
	console.log(output);
	if (!result.passed) {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}

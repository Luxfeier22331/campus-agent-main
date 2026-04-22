import fs from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client, type ClientConfig } from "pg";

import type { Env } from "../src/config";
import { buildOperatorDatabaseConfig } from "../src/db/runtime";
import { buildRequestProjectionProjector, createPgProjectionStore } from "../src/modules/projection";
import type { RequestExecutionStatus } from "../src/modules/runtime-command";

export const COLLECTION_RENAME_MAP = {
	institutional_regulations: "institutional_rules",
	student_handbook: "student_rules",
} as const;

const LEGACY_COLLECTION_NAMES = Object.keys(COLLECTION_RENAME_MAP);
const LEGACY_SCOPE_SUMMARIES = LEGACY_COLLECTION_NAMES.map(
	(collection) => `regulations/${collection}`,
);

const COLLECTION_CASE_SQL = `
	case
		when collection = 'student_handbook' then 'student_rules'
		when collection = 'institutional_regulations' then 'institutional_rules'
		else collection
	end
`;

const RESOLVED_SCOPE_JSON_CASE_SQL = `
	case
		when resolved_scope_json->>'collection' = 'student_handbook'
			then jsonb_set(resolved_scope_json, '{collection}', to_jsonb('student_rules'::text), true)
		when resolved_scope_json->>'collection' = 'institutional_regulations'
			then jsonb_set(
				resolved_scope_json,
				'{collection}',
				to_jsonb('institutional_rules'::text),
				true
			)
		else resolved_scope_json
	end
`;

const RESOLVED_SCOPE_SUMMARY_CASE_SQL = `
	case
		when resolved_scope_summary = 'regulations/student_handbook' then 'regulations/student_rules'
		when resolved_scope_summary = 'regulations/institutional_regulations'
			then 'regulations/institutional_rules'
		else resolved_scope_summary
	end
`;

type LegacyCollectionName = keyof typeof COLLECTION_RENAME_MAP;
type ReplayEventType =
	| "request.accepted"
	| "request.completed"
	| "request.needs_clarification"
	| "request.no_answer"
	| "request.error"
	| "request.approval_required"
	| "request.rejected";

export interface CollectionRenameBackfillPlanInput {
	gradeCollection: string | null;
	requestId: string;
	requestStatus: RequestExecutionStatus;
	resolvedScopeJson: Record<string, unknown> | null;
	resolvedScopeSummary: string | null;
	runtimeCollection: string | null;
}

export interface CollectionRenameBackfillPlan {
	hasChanges: boolean;
	nextGradeCollection: string | null;
	nextResolvedScopeJson: Record<string, unknown> | null;
	nextResolvedScopeSummary: string | null;
	nextRuntimeCollection: string | null;
	replayEventType: ReplayEventType;
	requestId: string;
	requestStatus: RequestExecutionStatus;
}

export interface CollectionRenameBackfillAuditReport {
	affectedRequestIds: string[];
	command: "audit";
	tables: {
		metricRollupRows: number;
		qualityGradeRows: number;
		requestExecutionRows: number;
		requestObservabilityRows: number;
		requestProjectionRows: number;
	};
}

export interface CollectionRenameBackfillApplyReport {
	affectedRequestIds: string[];
	command: "apply";
	tables: {
		metricRollupRows: number;
		qualityGradeRows: number;
		requestExecutionRows: number;
		requestObservabilityRows: number;
		requestProjectionRows: number;
	};
}

export interface CollectionRenameReplayReport {
	command: "replay-projections";
	failed: number;
	processed: number;
	requestIds: string[];
	reusedOutboxEvents: number;
	syntheticOutboxEvents: number;
}

export type CollectionRenameBackfillReport =
	| CollectionRenameBackfillApplyReport
	| CollectionRenameBackfillAuditReport
	| CollectionRenameReplayReport;

export type CollectionRenameBackfillArgs =
	| {
			command: "audit";
			writeReportPath?: string;
	  }
	| {
			batchSize?: number;
			command: "apply";
			writeReportPath?: string;
	  }
	| {
			command: "replay-projections";
			reportPath?: string;
			requestIds: string[];
			writeReportPath?: string;
	  };

interface LocalCollectionRenameBackfillRuntime {
	env: Env;
	operatorClientConfig: ClientConfig;
}

function readOptionalString(
	env: NodeJS.ProcessEnv,
	key: keyof NodeJS.ProcessEnv,
): string | undefined {
	const value = env[key];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function readPositiveInteger(value: string | undefined, flagName: string): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`${flagName} must be a positive integer.`);
	}
	return parsed;
}

export function resolveCollectionRename(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	return COLLECTION_RENAME_MAP[value as LegacyCollectionName] ?? null;
}

export function rewriteScopeSummary(value: string | null): string | null {
	if (!value) {
		return value;
	}
	const legacyCollection = value.startsWith("regulations/") ? value.slice("regulations/".length) : "";
	const renamedCollection = resolveCollectionRename(legacyCollection);
	if (!renamedCollection) {
		return value;
	}
	return `regulations/${renamedCollection}`;
}

export function rewriteResolvedScope(
	scope: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!scope) {
		return scope;
	}
	const corpus = typeof scope.corpus === "string" ? scope.corpus : null;
	const collection = typeof scope.collection === "string" ? scope.collection : null;
	if (corpus !== "regulations" || !collection) {
		return scope;
	}
	const renamedCollection = resolveCollectionRename(collection);
	if (!renamedCollection) {
		return scope;
	}
	return {
		...scope,
		collection: renamedCollection,
	};
}

export function resolveProjectionReplayEventType(status: RequestExecutionStatus): ReplayEventType {
	switch (status) {
		case "accepted":
			return "request.accepted";
		case "completed":
			return "request.completed";
		case "needs_clarification":
			return "request.needs_clarification";
		case "no_answer":
			return "request.no_answer";
		case "error":
			return "request.error";
		case "approval_required":
			return "request.approval_required";
		case "rejected":
			return "request.rejected";
	}
}

export function buildCollectionRenameBackfillPlan(
	input: CollectionRenameBackfillPlanInput,
): CollectionRenameBackfillPlan {
	const nextResolvedScopeJson = rewriteResolvedScope(input.resolvedScopeJson);
	const nextRuntimeCollection =
		resolveCollectionRename(input.runtimeCollection) ?? input.runtimeCollection ?? null;
	const nextResolvedScopeSummary = rewriteScopeSummary(input.resolvedScopeSummary);
	const nextGradeCollection =
		resolveCollectionRename(input.gradeCollection) ??
		nextRuntimeCollection ??
		input.gradeCollection ??
		null;

	return {
		hasChanges:
			JSON.stringify(nextResolvedScopeJson) !== JSON.stringify(input.resolvedScopeJson) ||
			nextRuntimeCollection !== input.runtimeCollection ||
			nextResolvedScopeSummary !== input.resolvedScopeSummary ||
			nextGradeCollection !== input.gradeCollection,
		nextGradeCollection,
		nextResolvedScopeJson,
		nextResolvedScopeSummary,
		nextRuntimeCollection,
		replayEventType: resolveProjectionReplayEventType(input.requestStatus),
		requestId: input.requestId,
		requestStatus: input.requestStatus,
	};
}

export function parseCollectionRenameBackfillArgs(
	argv: string[],
): CollectionRenameBackfillArgs {
	const [commandToken, ...rest] = argv;
	if (!commandToken) {
		throw new Error("Expected one subcommand: audit, apply, replay-projections.");
	}

	if (commandToken === "audit") {
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token !== "--write-report") {
				throw new Error(`Unknown argument: ${token}`);
			}
			const value = rest[index + 1];
			if (!value?.trim()) {
				throw new Error("--write-report requires a non-empty value.");
			}
			writeReportPath = value;
			index += 1;
		}
		return {
			command: "audit",
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	if (commandToken === "apply") {
		let batchSize: number | undefined;
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token === "--batch-size") {
				batchSize = readPositiveInteger(rest[index + 1], "--batch-size");
				index += 1;
				continue;
			}
			if (token === "--write-report") {
				const value = rest[index + 1];
				if (!value?.trim()) {
					throw new Error("--write-report requires a non-empty value.");
				}
				writeReportPath = value;
				index += 1;
				continue;
			}
			throw new Error(`Unknown argument: ${token}`);
		}
		return {
			...(typeof batchSize === "number" ? { batchSize } : {}),
			command: "apply",
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	if (commandToken === "replay-projections") {
		const requestIds: string[] = [];
		let reportPath: string | undefined;
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token === "--request-id") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--request-id requires a non-empty value.");
				}
				requestIds.push(value);
				index += 1;
				continue;
			}
			if (token === "--report") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--report requires a non-empty value.");
				}
				reportPath = value;
				index += 1;
				continue;
			}
			if (token === "--write-report") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--write-report requires a non-empty value.");
				}
				writeReportPath = value;
				index += 1;
				continue;
			}
			throw new Error(`Unknown argument: ${token}`);
		}

		return {
			command: "replay-projections",
			...(reportPath ? { reportPath } : {}),
			requestIds,
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	throw new Error(`Unknown subcommand: ${commandToken}`);
}

export function buildLocalCollectionRenameBackfillRuntime(
	sourceEnv: NodeJS.ProcessEnv,
): LocalCollectionRenameBackfillRuntime {
	const baseEnv: Env = {
		APP_API_DATABASE_SSLMODE: readOptionalString(sourceEnv, "APP_API_DATABASE_SSLMODE") as
			| Env["APP_API_DATABASE_SSLMODE"]
			| undefined,
		APP_API_ENVIRONMENT: readOptionalString(sourceEnv, "APP_API_ENVIRONMENT") as
			| Env["APP_API_ENVIRONMENT"]
			| undefined,
		APP_API_OPERATOR_DATABASE_URL:
			readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL") ||
			readOptionalString(sourceEnv, "APP_API_MANAGEMENT_DATABASE_URL"),
		APP_API_MANAGEMENT_DATABASE_URL:
			readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL") ||
			readOptionalString(sourceEnv, "APP_API_MANAGEMENT_DATABASE_URL"),
	};
	const operatorClientConfig = buildOperatorDatabaseConfig(baseEnv);
	const runtimeConnectionString =
		readOptionalString(sourceEnv, "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB") ||
		operatorClientConfig.connectionString;

	return {
		env: {
			...baseEnv,
			APP_API_DB: {
				connectionString: runtimeConnectionString,
			},
		},
		operatorClientConfig,
	};
}

async function connectOperatorClient(runtime: LocalCollectionRenameBackfillRuntime) {
	const client = new Client(runtime.operatorClientConfig);
	await client.connect();
	return client;
}

async function listAffectedRequestIds(client: Client): Promise<string[]> {
	const result = await client.query<{ request_id: string }>(
		`
			with affected as (
				select request_id
				from runtime.request_execution
				where resolved_scope_json->>'collection' = any($1::text[])
				union
				select request_id
				from runtime.request_observability_fact
				where collection = any($1::text[])
				   or resolved_scope_summary = any($2::text[])
				union
				select request_id
				from operator.request_projection
				where resolved_scope_json->>'collection' = any($1::text[])
				union
				select request_id
				from operator.metric_rollup
				where collection = any($1::text[])
				union
				select request_id
				from operator.quality_grade_projection
				where collection = any($1::text[])
			)
			select request_id
			from affected
			order by request_id asc
		`,
		[LEGACY_COLLECTION_NAMES, LEGACY_SCOPE_SUMMARIES],
	);
	return result.rows.map((row) => row.request_id);
}

async function querySingleCount(
	client: Client,
	sql: string,
	params: unknown[],
): Promise<number> {
	const result = await client.query<{ count: string }>(sql, params);
	return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function performCollectionRenameAudit(
	client: Client,
): Promise<CollectionRenameBackfillAuditReport> {
	const affectedRequestIds = await listAffectedRequestIds(client);
	const requestExecutionRows = await querySingleCount(
		client,
		`
			select count(*)::text as count
			from runtime.request_execution
			where resolved_scope_json->>'collection' = any($1::text[])
		`,
		[LEGACY_COLLECTION_NAMES],
	);
	const requestObservabilityRows = await querySingleCount(
		client,
		`
			select count(*)::text as count
			from runtime.request_observability_fact
			where collection = any($1::text[])
			   or resolved_scope_summary = any($2::text[])
		`,
		[LEGACY_COLLECTION_NAMES, LEGACY_SCOPE_SUMMARIES],
	);
	const requestProjectionRows = await querySingleCount(
		client,
		`
			select count(*)::text as count
			from operator.request_projection
			where resolved_scope_json->>'collection' = any($1::text[])
		`,
		[LEGACY_COLLECTION_NAMES],
	);
	const metricRollupRows = await querySingleCount(
		client,
		`
			select count(*)::text as count
			from operator.metric_rollup
			where collection = any($1::text[])
		`,
		[LEGACY_COLLECTION_NAMES],
	);
	const qualityGradeRows = await querySingleCount(
		client,
		`
			select count(*)::text as count
			from operator.quality_grade_projection
			where collection = any($1::text[])
		`,
		[LEGACY_COLLECTION_NAMES],
	);

	return {
		affectedRequestIds,
		command: "audit",
		tables: {
			metricRollupRows,
			qualityGradeRows,
			requestExecutionRows,
			requestObservabilityRows,
			requestProjectionRows,
		},
	};
}

function chunkValues<T>(values: T[], batchSize: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += batchSize) {
		chunks.push(values.slice(index, index + batchSize));
	}
	return chunks;
}

async function performCollectionRenameApply(input: {
	batchSize: number;
	client: Client;
}): Promise<CollectionRenameBackfillApplyReport> {
	const affectedRequestIds = await listAffectedRequestIds(input.client);
	const appliedCounts = {
		metricRollupRows: 0,
		qualityGradeRows: 0,
		requestExecutionRows: 0,
		requestObservabilityRows: 0,
		requestProjectionRows: 0,
	};
	const runtimeUpdatedAt = new Date().toISOString();
	const operatorProjectedAt = new Date().toISOString();

	for (const batch of chunkValues(affectedRequestIds, input.batchSize)) {
		if (batch.length === 0) {
			continue;
		}

		await input.client.query("begin");
		try {
			const requestExecution = await input.client.query(
				`
					update runtime.request_execution
					set resolved_scope_json = ${RESOLVED_SCOPE_JSON_CASE_SQL},
						updated_at = $2::timestamptz
					where request_id = any($1::text[])
					  and resolved_scope_json->>'collection' = any($3::text[])
				`,
				[batch, runtimeUpdatedAt, LEGACY_COLLECTION_NAMES],
			);
			appliedCounts.requestExecutionRows += requestExecution.rowCount ?? 0;

			const requestObservability = await input.client.query(
				`
					update runtime.request_observability_fact
					set collection = ${COLLECTION_CASE_SQL},
						resolved_scope_summary = ${RESOLVED_SCOPE_SUMMARY_CASE_SQL},
						updated_at = $2::timestamptz
					where request_id = any($1::text[])
					  and (
						collection = any($3::text[])
						or resolved_scope_summary = any($4::text[])
					  )
				`,
				[batch, runtimeUpdatedAt, LEGACY_COLLECTION_NAMES, LEGACY_SCOPE_SUMMARIES],
			);
			appliedCounts.requestObservabilityRows += requestObservability.rowCount ?? 0;

			const requestProjection = await input.client.query(
				`
					update operator.request_projection
					set resolved_scope_json = ${RESOLVED_SCOPE_JSON_CASE_SQL},
						projected_at = $2::timestamptz
					where request_id = any($1::text[])
					  and resolved_scope_json->>'collection' = any($3::text[])
				`,
				[batch, operatorProjectedAt, LEGACY_COLLECTION_NAMES],
			);
			appliedCounts.requestProjectionRows += requestProjection.rowCount ?? 0;

			const metricRollup = await input.client.query(
				`
					update operator.metric_rollup
					set collection = ${COLLECTION_CASE_SQL},
						projected_at = $2::timestamptz
					where request_id = any($1::text[])
					  and collection = any($3::text[])
				`,
				[batch, operatorProjectedAt, LEGACY_COLLECTION_NAMES],
			);
			appliedCounts.metricRollupRows += metricRollup.rowCount ?? 0;

			const qualityGrade = await input.client.query(
				`
					update operator.quality_grade_projection
					set collection = ${COLLECTION_CASE_SQL},
						projected_at = $2::timestamptz
					where request_id = any($1::text[])
					  and collection = any($3::text[])
				`,
				[batch, operatorProjectedAt, LEGACY_COLLECTION_NAMES],
			);
			appliedCounts.qualityGradeRows += qualityGrade.rowCount ?? 0;

			await input.client.query("commit");
		} catch (error) {
			await input.client.query("rollback");
			throw error;
		}
	}

	return {
		affectedRequestIds,
		command: "apply",
		tables: appliedCounts,
	};
}

async function readReplayRequestIds(input: {
	reportPath?: string;
	requestIds: string[];
}): Promise<string[]> {
	const requestIds = [...input.requestIds];
	if (!input.reportPath) {
		return Array.from(new Set(requestIds));
	}

	const rawReport = await fs.readFile(input.reportPath, "utf-8");
	const parsed = JSON.parse(rawReport) as { affectedRequestIds?: string[] };
	for (const requestId of parsed.affectedRequestIds ?? []) {
		if (typeof requestId === "string" && requestId.trim()) {
			requestIds.push(requestId.trim());
		}
	}
	return Array.from(new Set(requestIds));
}

async function requeueProjectionEvent(input: {
	client: Client;
	eventType: ReplayEventType;
	requestId: string;
}): Promise<"reused" | "synthetic"> {
	const now = new Date().toISOString();
	const existingEvent = await input.client.query<{ event_id: string }>(
		`
			select event_id
			from runtime.projection_outbox
			where request_id = $1
			  and event_type = $2
			order by occurred_at desc, event_id desc
			limit 1
		`,
		[input.requestId, input.eventType],
	);
	const eventId = existingEvent.rows[0]?.event_id ?? null;
	if (eventId) {
		await input.client.query(
			`
				update runtime.projection_outbox
				set available_at = $2::timestamptz,
					attempt_count = 0,
					last_error = null,
					processed_at = null
				where event_id = $1
			`,
			[eventId, now],
		);
		return "reused";
	}

	await input.client.query(
		`
			insert into runtime.projection_outbox (
				event_id,
				request_id,
				event_type,
				payload_json,
				occurred_at,
				available_at,
				processed_at,
				attempt_count,
				last_error
			)
			values ($1, $2, $3, $4::jsonb, $5::timestamptz, $5::timestamptz, null, 0, null)
			on conflict (event_id) do update
			set request_id = excluded.request_id,
				event_type = excluded.event_type,
				payload_json = excluded.payload_json,
				occurred_at = excluded.occurred_at,
				available_at = excluded.available_at,
				processed_at = null,
				attempt_count = 0,
				last_error = null
		`,
		[
			`collection-rename-backfill:${input.requestId}:${input.eventType}`,
			input.requestId,
			input.eventType,
			JSON.stringify({
				eventType: input.eventType,
				requestId: input.requestId,
				source: "collection_rename_backfill",
			}),
			now,
		],
	);
	return "synthetic";
}

async function performCollectionRenameReplay(input: {
	client: Client;
	requestIds: string[];
	runtime: LocalCollectionRenameBackfillRuntime;
}): Promise<CollectionRenameReplayReport> {
	const projector = buildRequestProjectionProjector({
		store: createPgProjectionStore(input.runtime.env),
	});
	let failed = 0;
	let processed = 0;
	let reusedOutboxEvents = 0;
	let syntheticOutboxEvents = 0;

	for (const requestId of input.requestIds) {
		const execution = await input.client.query<{ status: RequestExecutionStatus }>(
			`
				select status
				from runtime.request_execution
				where request_id = $1
				limit 1
			`,
			[requestId],
		);
		const status = execution.rows[0]?.status;
		if (!status) {
			failed += 1;
			continue;
		}

		const queueOutcome = await requeueProjectionEvent({
			client: input.client,
			eventType: resolveProjectionReplayEventType(status),
			requestId,
		});
		if (queueOutcome === "reused") {
			reusedOutboxEvents += 1;
		} else {
			syntheticOutboxEvents += 1;
		}

		const result = await projector.drainRequest(requestId);
		failed += result.failed;
		processed += result.processed;
	}

	return {
		command: "replay-projections",
		failed,
		processed,
		requestIds: input.requestIds,
		reusedOutboxEvents,
		syntheticOutboxEvents,
	};
}

async function writeReportIfRequested(
	report: CollectionRenameBackfillReport,
	writeReportPath: string | undefined,
) {
	if (!writeReportPath) {
		return;
	}
	await fs.writeFile(writeReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

export async function runCollectionRenameBackfill(
	runtime: LocalCollectionRenameBackfillRuntime,
	args: CollectionRenameBackfillArgs,
): Promise<CollectionRenameBackfillReport> {
	const client = await connectOperatorClient(runtime);
	try {
		if (args.command === "audit") {
			const report = await performCollectionRenameAudit(client);
			await writeReportIfRequested(report, args.writeReportPath);
			return report;
		}
		if (args.command === "apply") {
			const report = await performCollectionRenameApply({
				batchSize: args.batchSize ?? 100,
				client,
			});
			await writeReportIfRequested(report, args.writeReportPath);
			return report;
		}

		const requestIds = await readReplayRequestIds({
			reportPath: args.reportPath,
			requestIds: args.requestIds,
		});
		if (requestIds.length === 0) {
			throw new Error("Replay requires at least one request id or an --report file.");
		}
		const report = await performCollectionRenameReplay({
			client,
			requestIds,
			runtime,
		});
		await writeReportIfRequested(report, args.writeReportPath);
		return report;
	} finally {
		await client.end();
	}
}

async function main(argv: string[]) {
	const args = parseCollectionRenameBackfillArgs(argv);
	const runtime = buildLocalCollectionRenameBackfillRuntime(process.env);
	const report = await runCollectionRenameBackfill(runtime, args);
	console.log(JSON.stringify(report, null, 2));
}

const isEntrypoint =
	typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	void main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}

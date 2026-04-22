import fs from "node:fs/promises";

import type { Client } from "pg";

import {
	buildRequestProjectionProjector,
	createPgProjectionStore,
} from "../src/modules/projection";
import type { RequestExecutionStatus } from "../src/modules/runtime-command";

import { resolveProjectionReplayEventType } from "./collection-rename-backfill.plan";
import { connectOperatorClient } from "./collection-rename-backfill.runtime";
import type {
	CollectionRenameBackfillApplyReport,
	CollectionRenameBackfillArgs,
	CollectionRenameBackfillAuditReport,
	CollectionRenameBackfillReport,
	CollectionRenameReplayReport,
	LocalCollectionRenameBackfillRuntime,
	ReplayEventType,
} from "./collection-rename-backfill.shared";
import {
	COLLECTION_CASE_SQL,
	LEGACY_COLLECTION_NAMES,
	LEGACY_SCOPE_SUMMARIES,
	RESOLVED_SCOPE_JSON_CASE_SQL,
	RESOLVED_SCOPE_SUMMARY_CASE_SQL,
} from "./collection-rename-backfill.shared";

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

async function querySingleCount(client: Client, sql: string, params: unknown[]): Promise<number> {
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

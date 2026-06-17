import type { CollectorRunLedgerRecord } from "./collector-run-ledger.js";

export interface VerifiedRunEnqueueInput {
	ledgerRecord: CollectorRunLedgerRecord;
	siteId: string;
}

export interface IngestionTaskEnvelope {
	schema_version: "ingestion_task_envelope.v1";
	task_id: string;
	run_id: string;
	source_family: string;
	source_channel: string;
	corpus: string;
	collection: string;
	task_kind: string;
	input_ref: {
		kind: "inline";
		uri: string;
	};
	output_contract: string;
	idempotency_key: string;
	lease_policy: {
		lease_seconds: number;
		heartbeat_seconds: number;
	};
	retry_policy: {
		max_attempts: number;
	};
	created_by: string;
	created_at: string;
}

export interface VerifiedRunTaskInput {
	collectedAt: string;
	runId: string;
	siteId: string;
	sourceSurface: string;
}

export function buildVerifiedRunTaskEnvelope(input: VerifiedRunTaskInput): IngestionTaskEnvelope {
	const idempotencyKey = [
		"authenticated_notice_portal",
		input.siteId,
		input.sourceSurface,
		input.runId,
	].join("/");
	return {
		schema_version: "ingestion_task_envelope.v1",
		task_id: `authenticated_notice_collector_run:${input.runId}`,
		run_id: input.runId,
		source_family: "authenticated_notice",
		source_channel: input.siteId,
		corpus: "campus_notices",
		collection: "internal_notice",
		task_kind: "source_truth_materialize",
		input_ref: {
			kind: "inline",
			uri: `collector-run://${input.siteId}/${input.sourceSurface}/${input.runId}`,
		},
		output_contract: "authenticated_notice_source_truth.v1",
		idempotency_key: idempotencyKey,
		lease_policy: {
			lease_seconds: 300,
			heartbeat_seconds: 30,
		},
		retry_policy: {
			max_attempts: 3,
		},
		created_by: "authenticated-notice-collector",
		created_at: input.collectedAt,
	};
}

export function buildVerifiedCollectorRunTask(
	input: VerifiedRunEnqueueInput,
): IngestionTaskEnvelope {
	assertVerifiedLedgerRecord(input.ledgerRecord);
	return buildVerifiedRunTaskEnvelope({
		collectedAt: input.ledgerRecord.finishedAt ?? input.ledgerRecord.startedAt,
		runId: input.ledgerRecord.runId,
		siteId: input.siteId,
		sourceSurface: input.ledgerRecord.sourceSurface,
	});
}

function assertVerifiedLedgerRecord(record: CollectorRunLedgerRecord): void {
	if (record.status !== "success" || record.verificationStatus !== "verified") {
		throw new Error(
			`collector run is not verified for enqueue: ${record.runId} ${record.status}/${record.verificationStatus}`,
		);
	}
}

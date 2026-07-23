import { randomUUID } from "node:crypto";

import { sha256Tag, stableJson } from "@campus-agent/dining/domain";
import { Client } from "pg";

import type {
	DiningSourceObservation,
	FeishuCatalogSourceIdentity,
	FeishuReviewSourceIdentity,
} from "./catalog-source-types.ts";

export type DiningSourceType = DiningSourceObservation["sourceType"];

export interface DiningSyncRun {
	runId: string;
	sourceType: DiningSourceType;
	startedAt: Date;
}

export interface DiningObservationState {
	observation: DiningSourceObservation;
	processingHash: string;
}

export interface DiningObservationSyncReport {
	acceptedCount: number;
	blockedCount: number;
	runId: string;
	staleCount: number;
	totalCount: number;
}

export class DiningEmptySnapshotError extends Error {
	constructor(sourceType: DiningSourceType) {
		super(`Dining ${sourceType} snapshot is empty while active observations exist.`);
		this.name = "DiningEmptySnapshotError";
	}
}

export interface DiningPgClient {
	connect(): Promise<unknown>;
	end(): Promise<unknown>;
	query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type DiningPgClientFactory = () => DiningPgClient;

export class PostgresDiningSourceObservationStore {
	private readonly createClient: DiningPgClientFactory;

	constructor(input: { databaseUrl: string } | { createClient: DiningPgClientFactory }) {
		this.createClient =
			"createClient" in input
				? input.createClient
				: () => new Client({ connectionString: input.databaseUrl });
	}

	async startRun(sourceType: DiningSourceType): Promise<DiningSyncRun> {
		const run: DiningSyncRun = {
			runId: `dining_${sourceType}_sync:${randomUUID()}`,
			sourceType,
			startedAt: new Date(),
		};
		await this.withClient(async (client) => {
			await client.query(
				`UPDATE dining.source_sync_runs SET status='failed',completed_at=now(),
					error_code='run_abandoned',error_message='The worker stopped before completing this run.'
				 WHERE source_type=$1 AND status='running' AND started_at < now() - interval '30 minutes'`,
				[sourceType],
			);
			await client.query(
				`INSERT INTO dining.source_sync_runs(
					run_id,source_type,started_at,status,total_count,accepted_count,blocked_count,stale_count
				) VALUES($1,$2,$3,'running',0,0,0,0)`,
				[run.runId, run.sourceType, run.startedAt],
			);
		});
		return run;
	}

	async succeedRun(run: DiningSyncRun): Promise<void> {
		await this.withClient(async (client) => {
			await client.query(
				`UPDATE dining.source_sync_runs SET status='succeeded',completed_at=$1,
					error_code=NULL,error_message=NULL WHERE run_id=$2 AND status='running'`,
				[new Date(), run.runId],
			);
		});
	}

	async failRun(run: DiningSyncRun, errorCode: string, error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		await this.withClient(async (client) => {
			await client.query(
				`UPDATE dining.source_sync_runs
				 SET status='failed',completed_at=$1,error_code=$2,error_message=$3
				 WHERE run_id=$4 AND status='running'`,
				[new Date(), errorCode, message.slice(0, 500), run.runId],
			);
		});
	}

	async completeCatalogRun(input: {
		observations: DiningSourceObservation[];
		run: DiningSyncRun;
		sourceIdentity: FeishuCatalogSourceIdentity;
	}): Promise<DiningObservationSyncReport> {
		return this.completeRun(input);
	}

	async completeReviewRun(input: {
		observations: DiningSourceObservation[];
		processingHashes: ReadonlyMap<string, string>;
		run: DiningSyncRun;
		sourceIdentity: FeishuReviewSourceIdentity;
	}): Promise<DiningObservationSyncReport> {
		return this.completeRun(input);
	}

	async listActiveCatalogObservations(): Promise<DiningSourceObservation[]> {
		return this.listActiveObservations("feishu_catalog");
	}

	async listActiveReviewObservations(): Promise<DiningSourceObservation[]> {
		return this.listActiveObservations("feishu_review");
	}

	async loadActiveReviewStates(): Promise<Map<string, DiningObservationState>> {
		const client = this.createClient();
		await client.connect();
		try {
			const result = await client.query(
				`SELECT observation_id,source_type,target_kind,target_id,payload_json,status,observed_at,
					processing_hash
				 FROM dining.source_observations
				 WHERE source_type='feishu_review' AND stale_at IS NULL`,
			);
			return new Map(
				result.rows.map((row) => {
					const observation = rowToObservation(row);
					return [
						observation.observationId,
						{ observation, processingHash: requireString(row.processing_hash, "processing_hash") },
					];
				}),
			);
		} finally {
			await client.end();
		}
	}

	private async completeRun(input: {
		observations: DiningSourceObservation[];
		processingHashes?: ReadonlyMap<string, string>;
		run: DiningSyncRun;
		sourceIdentity: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity;
	}): Promise<DiningObservationSyncReport> {
		if (
			input.run.sourceType !== input.observations[0]?.sourceType &&
			input.observations.length > 0
		) {
			throw new Error("Dining source run and observation types do not match.");
		}
		const acceptedCount = input.observations.filter((item) => item.status === "accepted").length;
		const blockedCount = input.observations.filter((item) => item.status === "blocked").length;
		const client = this.createClient();
		await client.connect();
		try {
			await client.query("BEGIN");
			try {
				const active = await client.query(
					`SELECT count(*)::int AS count FROM dining.source_observations
					 WHERE source_type=$1 AND stale_at IS NULL`,
					[input.run.sourceType],
				);
				if (input.observations.length === 0 && Number(active.rows[0]?.count ?? 0) > 0) {
					throw new DiningEmptySnapshotError(input.run.sourceType);
				}
				for (const observation of input.observations) {
					if (observation.sourceType !== input.run.sourceType) {
						throw new Error(`Dining observation type mismatch: ${observation.sourceType}.`);
					}
					const processingHash =
						input.processingHashes?.get(observation.observationId) ?? contentHash(observation);
					await upsertObservation(client, {
						observation,
						processingHash,
						run: input.run,
						sourceIdentity: input.sourceIdentity,
					});
				}
				const snapshotAppliedAt = new Date();
				const staleResult = await client.query(
					`UPDATE dining.source_observations
					 SET stale_at=$1
					 WHERE source_type=$2 AND last_seen_run_id IS DISTINCT FROM $3 AND stale_at IS NULL
					 RETURNING observation_id`,
					[snapshotAppliedAt, input.run.sourceType, input.run.runId],
				);
				await client.query(
					`UPDATE dining.source_sync_runs SET total_count=$1,accepted_count=$2,
						blocked_count=$3,stale_count=$4
					 WHERE run_id=$5 AND status='running'`,
					[
						input.observations.length,
						acceptedCount,
						blockedCount,
						staleResult.rows.length,
						input.run.runId,
					],
				);
				await client.query("COMMIT");
				return {
					acceptedCount,
					blockedCount,
					runId: input.run.runId,
					staleCount: staleResult.rows.length,
					totalCount: input.observations.length,
				};
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		} finally {
			await client.end();
		}
	}

	private async listActiveObservations(
		sourceType: DiningSourceType,
	): Promise<DiningSourceObservation[]> {
		const client = this.createClient();
		await client.connect();
		try {
			const result = await client.query(
				`SELECT observation_id,source_type,target_kind,target_id,payload_json,status,observed_at
				 FROM dining.source_observations
				 WHERE source_type=$1 AND stale_at IS NULL
				 ORDER BY target_kind,observation_id`,
				[sourceType],
			);
			return result.rows.map(rowToObservation);
		} finally {
			await client.end();
		}
	}

	private async withClient(work: (client: DiningPgClient) => Promise<void>): Promise<void> {
		const client = this.createClient();
		await client.connect();
		try {
			await work(client);
		} finally {
			await client.end();
		}
	}
}

async function upsertObservation(
	client: DiningPgClient,
	input: {
		observation: DiningSourceObservation;
		processingHash: string;
		run: DiningSyncRun;
		sourceIdentity: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity;
	},
): Promise<void> {
	const observation = input.observation;
	await client.query(
		`INSERT INTO dining.source_observations(
			observation_id,source_type,source_base_token,source_table_id,source_record_id,
			target_kind,target_id,payload_json,content_hash,processing_hash,status,observed_at,
			first_seen_at,last_seen_at,last_seen_run_id,stale_at
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$13,$14,NULL)
		ON CONFLICT(observation_id) DO UPDATE SET
			source_base_token=EXCLUDED.source_base_token,source_table_id=EXCLUDED.source_table_id,
			source_record_id=EXCLUDED.source_record_id,target_kind=EXCLUDED.target_kind,
			target_id=EXCLUDED.target_id,payload_json=EXCLUDED.payload_json,
			content_hash=EXCLUDED.content_hash,processing_hash=EXCLUDED.processing_hash,
			status=EXCLUDED.status,observed_at=EXCLUDED.observed_at,last_seen_at=EXCLUDED.last_seen_at,
			last_seen_run_id=EXCLUDED.last_seen_run_id,stale_at=NULL`,
		[
			observation.observationId,
			observation.sourceType,
			input.sourceIdentity.baseToken,
			sourceTableIdForObservation(observation, input.sourceIdentity),
			sourceRecordIdForObservation(observation),
			observation.targetKind,
			observation.targetId,
			JSON.stringify(observation.payloadJson),
			contentHash(observation),
			input.processingHash,
			observation.status,
			new Date(observation.observedAt),
			input.run.startedAt,
			input.run.runId,
		],
	);
}

function rowToObservation(row: Record<string, unknown>): DiningSourceObservation {
	return {
		observationId: requireString(row.observation_id, "observation_id"),
		observedAt: dateToIso(row.observed_at, "observed_at"),
		payloadJson: requireRecord(row.payload_json, "payload_json"),
		sourceType: requireSourceType(row.source_type),
		status: requireObservationStatus(row.status),
		targetId: typeof row.target_id === "string" ? row.target_id : null,
		targetKind: requireTargetKind(row.target_kind),
	};
}

function sourceRecordIdForObservation(observation: DiningSourceObservation): string | null {
	const sourceRecordId = observation.payloadJson.sourceRecordId;
	return typeof sourceRecordId === "string" && sourceRecordId.trim() ? sourceRecordId : null;
}

function sourceTableIdForObservation(
	observation: DiningSourceObservation,
	sourceIdentity: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity,
): string {
	if ("reviewTableId" in sourceIdentity) {
		return sourceIdentity.reviewTableId;
	}
	if (observation.targetKind === "campus") {
		return sourceIdentity.campusTableId;
	}
	if (observation.targetKind === "hall") {
		return sourceIdentity.hallTableId;
	}
	if (observation.targetKind === "stall") {
		return sourceIdentity.stallTableId;
	}
	return sourceIdentity.dishTableId;
}

function contentHash(observation: DiningSourceObservation): string {
	return sha256Tag(
		stableJson({
			payloadJson: observation.payloadJson,
			sourceType: observation.sourceType,
			status: observation.status,
			targetId: observation.targetId,
			targetKind: observation.targetKind,
		}),
	);
}

function dateToIso(value: unknown, fieldName: string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		return new Date(value).toISOString();
	}
	throw new Error(`Invalid dining source observation ${fieldName}.`);
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || !value) {
		throw new Error(`Invalid dining source observation ${fieldName}.`);
	}
	return value;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid dining source observation ${fieldName}.`);
	}
	return value as Record<string, unknown>;
}

function requireSourceType(value: unknown): DiningSourceType {
	if (value === "feishu_catalog" || value === "feishu_review") {
		return value;
	}
	throw new Error("Invalid dining source observation source type.");
}

function requireObservationStatus(value: unknown): DiningSourceObservation["status"] {
	if (value === "accepted" || value === "blocked" || value === "observed") {
		return value;
	}
	throw new Error("Invalid dining source observation status.");
}

function requireTargetKind(value: unknown): DiningSourceObservation["targetKind"] {
	if (
		value === "campus" ||
		value === "hall" ||
		value === "menu_item" ||
		value === "menu_offering" ||
		value === "review" ||
		value === "stall"
	) {
		return value;
	}
	throw new Error("Invalid dining source observation target kind.");
}

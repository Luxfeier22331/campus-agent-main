import { createHash, randomUUID } from "node:crypto";

import { Client } from "pg";

import type {
	DiningSourceObservation,
	FeishuCatalogSourceIdentity,
	FeishuReviewSourceIdentity,
} from "./catalog-source-types.ts";

export interface DiningCatalogPgClient {
	connect(): Promise<unknown>;
	end(): Promise<unknown>;
	query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type DiningCatalogPgClientFactory = () => DiningCatalogPgClient;

export interface DiningObservationSyncReport {
	acceptedCount: number;
	blockedCount: number;
	runId: string;
	staleCount: number;
	totalCount: number;
}

export class PostgresDiningSourceObservationStore {
	private readonly createClient: DiningCatalogPgClientFactory;

	constructor(input: { databaseUrl: string } | { createClient: DiningCatalogPgClientFactory }) {
		this.createClient =
			"createClient" in input
				? input.createClient
				: () => new Client({ connectionString: input.databaseUrl });
	}

	async upsertFeishuCatalogObservations(
		observations: DiningSourceObservation[],
		sourceIdentity?: FeishuCatalogSourceIdentity,
	): Promise<DiningObservationSyncReport> {
		return this.upsertObservations({
			observations,
			sourceIdentity,
			sourceType: "feishu_catalog",
		});
	}

	async upsertFeishuReviewObservations(
		observations: DiningSourceObservation[],
		sourceIdentity?: FeishuReviewSourceIdentity,
	): Promise<DiningObservationSyncReport> {
		return this.upsertObservations({
			observations,
			sourceIdentity,
			sourceType: "feishu_review",
		});
	}

	async listActiveFeishuCatalogObservations(): Promise<DiningSourceObservation[]> {
		return this.listActiveObservations("feishu_catalog");
	}

	async listActiveFeishuReviewObservations(): Promise<DiningSourceObservation[]> {
		return this.listActiveObservations("feishu_review");
	}

	private async upsertObservations(input: {
		observations: DiningSourceObservation[];
		sourceIdentity?: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity;
		sourceType: DiningSourceObservation["sourceType"];
	}): Promise<DiningObservationSyncReport> {
		const client = this.createClient();
		await client.connect();
		try {
			return await upsertObservations(client, input);
		} finally {
			await client.end();
		}
	}

	private async listActiveObservations(
		sourceType: DiningSourceObservation["sourceType"],
	): Promise<DiningSourceObservation[]> {
		const client = this.createClient();
		await client.connect();
		try {
			const result = await client.query(
				`SELECT
					"observation_id", "source_type", "target_kind", "target_id", "payload_json",
					"status", "observed_at"
				FROM "dining"."source_observations"
				WHERE "source_type" = $1
					AND "stale_at" IS NULL
				ORDER BY "target_kind", "observation_id"`,
				[sourceType],
			);
			return result.rows.map(rowToObservation);
		} finally {
			await client.end();
		}
	}
}

async function upsertObservations(
	client: DiningCatalogPgClient,
	input: {
		observations: DiningSourceObservation[];
		sourceIdentity?: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity;
		sourceType: DiningSourceObservation["sourceType"];
	},
): Promise<DiningObservationSyncReport> {
	const runId = `dining_${input.sourceType}_sync:${randomUUID()}`;
	const startedAt = new Date();
	const acceptedCount = input.observations.filter((observation) => observation.status === "accepted").length;
	const blockedCount = input.observations.filter((observation) => observation.status === "blocked").length;
	await client.query("BEGIN");
	try {
		await client.query(
			`INSERT INTO "dining"."source_sync_runs" (
				"run_id", "source_type", "started_at", "status", "total_count",
				"accepted_count", "blocked_count"
			) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				runId,
				input.sourceType,
				startedAt,
				"running",
				input.observations.length,
				acceptedCount,
				blockedCount,
			],
		);

		for (const observation of input.observations) {
			if (observation.sourceType !== input.sourceType) {
				throw new Error(`Dining source observation type mismatch: ${observation.sourceType}.`);
			}
			const sourceRecordId = sourceRecordIdForObservation(observation);
			await client.query(
				`INSERT INTO "dining"."source_observations" (
					"observation_id", "source_type", "source_base_token", "source_table_id",
					"source_record_id", "target_kind", "target_id", "payload_json", "content_hash",
					"status", "observed_at", "first_seen_at", "last_seen_at", "last_seen_run_id",
					"stale_at"
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, NULL
				)
				ON CONFLICT ("observation_id") DO UPDATE SET
					"source_base_token" = EXCLUDED."source_base_token",
					"source_table_id" = EXCLUDED."source_table_id",
					"source_record_id" = EXCLUDED."source_record_id",
					"target_kind" = EXCLUDED."target_kind",
					"target_id" = EXCLUDED."target_id",
					"payload_json" = EXCLUDED."payload_json",
					"content_hash" = EXCLUDED."content_hash",
					"status" = EXCLUDED."status",
					"observed_at" = EXCLUDED."observed_at",
					"last_seen_at" = EXCLUDED."last_seen_at",
					"last_seen_run_id" = EXCLUDED."last_seen_run_id",
					"stale_at" = NULL`,
				[
					observation.observationId,
					observation.sourceType,
					sourceBaseTokenFor(input.sourceIdentity),
					sourceTableIdForObservation(observation, input.sourceIdentity),
					sourceRecordId,
					observation.targetKind,
					observation.targetId,
					JSON.stringify(observation.payloadJson),
					contentHash(observation),
					observation.status,
					new Date(observation.observedAt),
					startedAt,
					startedAt,
					runId,
				],
			);
		}

		const staleResult = await client.query(
			`UPDATE "dining"."source_observations"
			SET "stale_at" = $1
			WHERE "source_type" = $2
				AND "last_seen_run_id" IS DISTINCT FROM $3
				AND "stale_at" IS NULL
			RETURNING "observation_id"`,
			[startedAt, input.sourceType, runId],
		);
		await client.query(
			`UPDATE "dining"."source_sync_runs"
			SET "completed_at" = $1, "status" = $2, "stale_count" = $3
			WHERE "run_id" = $4`,
			[startedAt, "completed", staleResult.rows.length, runId],
		);
		await client.query("COMMIT");
		return {
			acceptedCount,
			blockedCount,
			runId,
			staleCount: staleResult.rows.length,
			totalCount: input.observations.length,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
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

function sourceBaseTokenFor(
	sourceIdentity?: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity,
): string | null {
	return sourceIdentity?.baseToken ?? null;
}

function sourceTableIdForObservation(
	observation: DiningSourceObservation,
	sourceIdentity?: FeishuCatalogSourceIdentity | FeishuReviewSourceIdentity,
): string | null {
	if (!sourceIdentity) {
		return null;
	}
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
	return `sha256:${createHash("sha256").update(stableJson({
		payloadJson: observation.payloadJson,
		sourceType: observation.sourceType,
		status: observation.status,
		targetId: observation.targetId,
		targetKind: observation.targetKind,
	})).digest("hex")}`;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJson(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
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

function requireSourceType(value: unknown): DiningSourceObservation["sourceType"] {
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

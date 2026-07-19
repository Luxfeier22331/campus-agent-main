import { canonicalJsonString } from "ingest-core";
import type { PgClientLike, PgPoolLike } from "./postgres-store";
import type {
	OfflineReleaseRecord,
	OfflineReleaseStore,
	OfflineReleaseStreamRecord,
} from "./types";

export class OfflineReleaseConcurrencyError extends Error {
	readonly streamId: string;

	constructor(streamId: string) {
		super(`offline release stream changed while publishing: ${streamId}`);
		this.name = "OfflineReleaseConcurrencyError";
		this.streamId = streamId;
	}
}

export function createPostgresOfflineReleaseStore(input: {
	pool: PgPoolLike;
	now?: () => Date;
}): OfflineReleaseStore {
	return new PostgresOfflineReleaseStore(input);
}

class PostgresOfflineReleaseStore implements OfflineReleaseStore {
	readonly #pool: PgPoolLike;
	readonly #now: () => Date;

	constructor(input: { pool: PgPoolLike; now?: () => Date }) {
		this.#pool = input.pool;
		this.#now = input.now ?? (() => new Date());
	}

	async ensureStream(input: {
		collection: string;
		corpus: string;
		sourceChannel: string;
		sourceSurface: "file_release" | "notice";
		streamId: string;
	}): Promise<OfflineReleaseStreamRecord> {
		const now = this.#now().toISOString();
		return this.#withClient(async (client) => {
			await client.query(
				`INSERT INTO ingestion_control.offline_release_streams (
					stream_id, source_channel, source_surface, corpus, collection,
					current_release_id, checkpoint_json, version, created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, NULL, '{}'::jsonb, 0, $6::timestamptz, $6::timestamptz)
				ON CONFLICT (stream_id) DO NOTHING`,
				[
					input.streamId,
					input.sourceChannel,
					input.sourceSurface,
					input.corpus,
					input.collection,
					now,
				],
			);
			const result = await client.query(
				"SELECT * FROM ingestion_control.offline_release_streams WHERE stream_id = $1",
				[input.streamId],
			);
			const row = result.rows[0];
			if (!row) {
				throw new Error(`offline release stream was not created: ${input.streamId}`);
			}
			const stream = toStream(row);
			if (
				stream.source_channel !== input.sourceChannel ||
				stream.source_surface !== input.sourceSurface ||
				stream.corpus !== input.corpus ||
				stream.collection !== input.collection
			) {
				throw new Error(`offline release stream identity conflict: ${input.streamId}`);
			}
			return stream;
		});
	}

	async getStream(streamId: string): Promise<OfflineReleaseStreamRecord | null> {
		return this.#withClient(async (client) => {
			const result = await client.query(
				"SELECT * FROM ingestion_control.offline_release_streams WHERE stream_id = $1",
				[streamId],
			);
			return result.rows[0] ? toStream(result.rows[0]) : null;
		});
	}

	async getCurrentRelease(streamId: string): Promise<OfflineReleaseRecord | null> {
		return this.#withClient(async (client) => {
			const result = await client.query(
				`SELECT release.*
				 FROM ingestion_control.offline_release_streams stream
				 JOIN ingestion_control.offline_releases release
				   ON release.release_id = stream.current_release_id
				 WHERE stream.stream_id = $1`,
				[streamId],
			);
			return result.rows[0] ? toRelease(result.rows[0]) : null;
		});
	}

	async getReleaseByRun(streamId: string, runId: string): Promise<OfflineReleaseRecord | null> {
		return this.#withClient(async (client) => {
			const result = await client.query(
				`SELECT * FROM ingestion_control.offline_releases
				 WHERE stream_id = $1 AND run_id = $2`,
				[streamId, runId],
			);
			return result.rows[0] ? toRelease(result.rows[0]) : null;
		});
	}

	async recordCheck(input: Parameters<OfflineReleaseStore["recordCheck"]>[0]) {
		return this.#withClient(async (client) => {
			const result = await client.query(
				`UPDATE ingestion_control.offline_release_streams
				 SET last_check_at = $1::timestamptz,
				     last_check_mode = $2,
				     last_check_outcome = $3,
				     last_check_error_code = $4,
				     last_reconcile_at = CASE
				       WHEN $2 = 'reconcile' AND $3 IN ('published', 'unchanged') THEN $1::timestamptz
				       ELSE last_reconcile_at
				     END,
				     last_published_at = CASE WHEN $3 = 'published' THEN $1::timestamptz ELSE last_published_at END,
				     last_added_count = $5,
				     last_updated_count = $6,
				     last_withdrawn_count = $7,
				     updated_at = GREATEST(updated_at, $1::timestamptz)
				 WHERE stream_id = $8
				   AND (last_check_at IS NULL OR last_check_at <= $1::timestamptz)
				 RETURNING *`,
				[
					input.check.checkedAt,
					input.check.mode,
					input.check.outcome,
					input.check.errorCode,
					input.check.addedCount,
					input.check.updatedCount,
					input.check.withdrawnCount,
					input.streamId,
				],
			);
			const row = result.rows[0];
			if (row) {
				return toStream(row);
			}
			const current = await client.query(
				"SELECT * FROM ingestion_control.offline_release_streams WHERE stream_id = $1",
				[input.streamId],
			);
			return toStream(requiredRow(current.rows[0], "offline release stream check update"));
		});
	}

	async commitRelease(input: {
		check: Parameters<OfflineReleaseStore["commitRelease"]>[0]["check"];
		checkpoint: Record<string, unknown>;
		expectedStreamVersion: number;
		release: Omit<OfflineReleaseRecord, "committed_at">;
	}): Promise<{ release: OfflineReleaseRecord; stream: OfflineReleaseStreamRecord }> {
		const client = await this.#pool.connect();
		try {
			await client.query("BEGIN");
			const streamResult = await client.query(
				"SELECT * FROM ingestion_control.offline_release_streams WHERE stream_id = $1 FOR UPDATE",
				[input.release.stream_id],
			);
			const streamRow = streamResult.rows[0];
			if (!streamRow) {
				throw new Error(`offline release stream not found: ${input.release.stream_id}`);
			}
			const current = toStream(streamRow);
			const sameRunResult = await client.query(
				`SELECT * FROM ingestion_control.offline_releases
					 WHERE stream_id = $1 AND run_id = $2`,
				[input.release.stream_id, input.release.run_id],
			);
			if (sameRunResult.rows[0]) {
				const existing = toRelease(sameRunResult.rows[0]);
				if (!sameRelease(existing, input.release)) {
					throw new Error(`offline release run identity conflict: ${input.release.run_id}`);
				}
				await client.query("COMMIT");
				return { release: existing, stream: current };
			}
			if (current.current_release_id === input.release.release_id) {
				const existingResult = await client.query(
					"SELECT * FROM ingestion_control.offline_releases WHERE release_id = $1",
					[input.release.release_id],
				);
				const existing = existingResult.rows[0] ? toRelease(existingResult.rows[0]) : null;
				if (!(existing && sameRelease(existing, input.release))) {
					throw new Error(`offline release identity conflict: ${input.release.release_id}`);
				}
				await client.query("COMMIT");
				return { release: existing, stream: current };
			}
			if (current.version !== input.expectedStreamVersion) {
				throw new OfflineReleaseConcurrencyError(input.release.stream_id);
			}
			if (current.current_release_id !== input.release.previous_release_id) {
				throw new OfflineReleaseConcurrencyError(input.release.stream_id);
			}
			const committedAt = this.#now().toISOString();
			const releaseResult = await client.query(
				`INSERT INTO ingestion_control.offline_releases (
					release_id, stream_id, previous_release_id, run_id, workflow_id,
					workflow_run_id, manifest_ref_json, item_count, committed_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
				RETURNING *`,
				[
					input.release.release_id,
					input.release.stream_id,
					input.release.previous_release_id,
					input.release.run_id,
					input.release.workflow_id,
					input.release.workflow_run_id,
					JSON.stringify(input.release.manifest_ref),
					input.release.item_count,
					committedAt,
				],
			);
			const nextStreamResult = await client.query(
				`UPDATE ingestion_control.offline_release_streams
				 SET current_release_id = $1, checkpoint_json = $2::jsonb,
				     version = version + 1, updated_at = $3::timestamptz,
				     last_check_at = $4::timestamptz,
				     last_check_mode = $5,
				     last_check_outcome = $6,
				     last_check_error_code = $7,
				     last_reconcile_at = CASE WHEN $5 = 'reconcile' THEN $4::timestamptz ELSE last_reconcile_at END,
				     last_published_at = $4::timestamptz,
				     last_added_count = $8,
				     last_updated_count = $9,
				     last_withdrawn_count = $10
				 WHERE stream_id = $11 AND version = $12
				 RETURNING *`,
				[
					input.release.release_id,
					JSON.stringify(input.checkpoint),
					committedAt,
					input.check.checkedAt,
					input.check.mode,
					input.check.outcome,
					input.check.errorCode,
					input.check.addedCount,
					input.check.updatedCount,
					input.check.withdrawnCount,
					input.release.stream_id,
					input.expectedStreamVersion,
				],
			);
			if (!nextStreamResult.rows[0]) {
				throw new OfflineReleaseConcurrencyError(input.release.stream_id);
			}
			const committed = {
				release: toRelease(requiredRow(releaseResult.rows[0], "release insert")),
				stream: toStream(nextStreamResult.rows[0]),
			};
			await client.query("COMMIT");
			return committed;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async #withClient<T>(operation: (client: PgClientLike) => Promise<T>): Promise<T> {
		const client = await this.#pool.connect();
		try {
			return await operation(client);
		} finally {
			client.release();
		}
	}
}

function toStream(row: Record<string, unknown>): OfflineReleaseStreamRecord {
	const sourceSurface = requiredString(row.source_surface, "source_surface");
	if (sourceSurface !== "notice" && sourceSurface !== "file_release") {
		throw new Error(`unsupported source_surface: ${sourceSurface}`);
	}
	return {
		checkpoint: requiredObject(row.checkpoint_json, "checkpoint_json"),
		collection: requiredString(row.collection, "collection"),
		corpus: requiredString(row.corpus, "corpus"),
		created_at: requiredTimestamp(row.created_at, "created_at"),
		current_release_id: optionalString(row.current_release_id),
		source_channel: requiredString(row.source_channel, "source_channel"),
		source_surface: sourceSurface,
		stream_id: requiredString(row.stream_id, "stream_id"),
		updated_at: requiredTimestamp(row.updated_at, "updated_at"),
		version: requiredInteger(row.version, "version"),
		last_check_at: optionalTimestamp(row.last_check_at, "last_check_at"),
		last_check_mode: optionalCheckMode(row.last_check_mode),
		last_check_outcome: optionalCheckOutcome(row.last_check_outcome),
		last_check_error_code: optionalString(row.last_check_error_code),
		last_reconcile_at: optionalTimestamp(row.last_reconcile_at, "last_reconcile_at"),
		last_published_at: optionalTimestamp(row.last_published_at, "last_published_at"),
		last_added_count: requiredInteger(row.last_added_count, "last_added_count"),
		last_updated_count: requiredInteger(row.last_updated_count, "last_updated_count"),
		last_withdrawn_count: requiredInteger(row.last_withdrawn_count, "last_withdrawn_count"),
	};
}

function toRelease(row: Record<string, unknown>): OfflineReleaseRecord {
	return {
		committed_at: requiredTimestamp(row.committed_at, "committed_at"),
		item_count: requiredInteger(row.item_count, "item_count"),
		manifest_ref: requiredObject(
			row.manifest_ref_json,
			"manifest_ref_json",
		) as unknown as OfflineReleaseRecord["manifest_ref"],
		previous_release_id: optionalString(row.previous_release_id),
		release_id: requiredString(row.release_id, "release_id"),
		run_id: requiredString(row.run_id, "run_id"),
		stream_id: requiredString(row.stream_id, "stream_id"),
		workflow_id: requiredString(row.workflow_id, "workflow_id"),
		workflow_run_id: requiredString(row.workflow_run_id, "workflow_run_id"),
	};
}

function sameRelease(
	current: OfflineReleaseRecord,
	incoming: Omit<OfflineReleaseRecord, "committed_at">,
): boolean {
	const { committed_at: _committedAt, ...comparable } = current;
	return canonicalJsonString(comparable) === canonicalJsonString(incoming);
}

function requiredRow(
	row: Record<string, unknown> | undefined,
	label: string,
): Record<string, unknown> {
	if (!row) {
		throw new Error(`${label} returned no row`);
	}
	return row;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is required`);
	}
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function requiredInteger(value: unknown, label: string): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`${label} must be an integer`);
	}
	return parsed;
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredTimestamp(value: unknown, label: string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	const text = requiredString(value, label);
	if (Number.isNaN(Date.parse(text))) {
		throw new Error(`${label} must be a timestamp`);
	}
	return new Date(text).toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | null {
	return value === null || value === undefined ? null : requiredTimestamp(value, label);
}

function optionalCheckMode(value: unknown): OfflineReleaseStreamRecord["last_check_mode"] {
	return value === "incremental" || value === "reconcile" || value === "selected" ? value : null;
}

function optionalCheckOutcome(value: unknown): OfflineReleaseStreamRecord["last_check_outcome"] {
	return value === "published" ||
		value === "unchanged" ||
		value === "deferred" ||
		value === "failed"
		? value
		: null;
}

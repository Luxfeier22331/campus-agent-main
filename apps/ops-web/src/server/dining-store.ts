import type {
	DiningDraft,
	DiningPublication,
	DiningSourceObservation,
} from "@campus-agent/dining/domain";
import { Pool } from "pg";
import type { DiningPublicationStoreMethods } from "./dining-store-publication.ts";
import {
	createDiningPublicationStore,
	loadDiningDraft,
	loadDiningPublication,
} from "./dining-store-publication.ts";
import {
	type DiningPool,
	diningDateIso,
	diningDateIsoOrNull,
	diningObservationStatus,
	diningRecord,
	diningSourceType,
	diningTargetKind,
} from "./dining-store-repository.ts";
import type { DiningReviewStoreMethods } from "./dining-store-reviews.ts";
import { createDiningReviewStore } from "./dining-store-reviews.ts";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";
import { logOpsError } from "./safe-logging.ts";

export type { DiningCatalogCommand } from "./dining-store-publication.ts";
export {
	applyStoredOverride,
	buildDiningRollback,
	retainLatestReleases,
} from "./dining-store-publication.ts";
export { DiningStoreNotFoundError, DiningStoreValidationError } from "./dining-store-repository.ts";
export type { DiningOpsReview, DiningReviewCommand } from "./dining-store-reviews.ts";
export { loadReviewOfferingBinding } from "./dining-store-reviews.ts";

export interface DiningOpsOverview {
	draft: { baseReleaseId: string | null; revision: number; updatedAt: string; updatedBy: string };
	publication: DiningPublication;
	releases: number;
	reviews: { blocked: number; hidden: number; published: number };
	source: { latestRunAt: string | null; pendingCatalogObservations: number };
}

export interface DiningOpsSourceRun {
	acceptedCount: number;
	blockedCount: number;
	completedAt: string | null;
	runId: string;
	sourceType: string;
	staleCount: number;
	startedAt: string;
	status: string;
	totalCount: number;
}

export interface DiningOpsObservation extends DiningSourceObservation {
	staleAt: string | null;
}

export interface DiningStore extends DiningPublicationStoreMethods, DiningReviewStoreMethods {
	getOverview(): Promise<DiningOpsOverview>;
	listObservations(limit: number): Promise<DiningOpsObservation[]>;
	listSourceRuns(limit: number): Promise<DiningOpsSourceRun[]>;
	verifyReadiness(): Promise<void>;
}

export interface DiningStoreEnv {
	OPS_WEB_DINING_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_DINING_DATABASE_SSLMODE?: string;
	OPS_WEB_DINING_DATABASE_URL?: string;
	OPS_WEB_DINING_DB_POOL_MAX?: string;
}

export class DiningStoreUnavailableError extends Error {
	readonly code = "OPS_DINING_STORE_UNAVAILABLE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DiningStoreUnavailableError";
	}
}

export function createUnavailableDiningStore(error: unknown): DiningStore {
	const unavailable = async (): Promise<never> => {
		throw error instanceof DiningStoreUnavailableError
			? error
			: new DiningStoreUnavailableError("Dining operations database is unavailable.", {
					cause: error,
				});
	};
	return {
		applyCatalogCommand: unavailable,
		applyReviewCommand: unavailable,
		getDraft: unavailable,
		getOverview: unavailable,
		getRelease: unavailable,
		getReview: unavailable,
		listObservations: unavailable,
		listReleases: unavailable,
		listReviews: unavailable,
		listSourceRuns: unavailable,
		publish: unavailable,
		rebase: unavailable,
		rollback: unavailable,
		validate: unavailable,
		verifyReadiness: unavailable,
	};
}

export function createDiningStoreFromEnv(env: DiningStoreEnv): DiningStore {
	const databaseUrl = env.OPS_WEB_DINING_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new DiningStoreUnavailableError("Dining operations are not configured.");
	}
	const tls = resolvePostgresTlsConfig({
		caCertPath: env.OPS_WEB_DINING_DATABASE_CA_CERT_PATH,
		databaseUrl,
		deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT,
		nodeEnvironment: process.env.NODE_ENV,
		sslMode: env.OPS_WEB_DINING_DATABASE_SSLMODE,
	});
	const pool = new Pool({
		connectionString: tls.connectionString,
		max: boundedInteger(env.OPS_WEB_DINING_DB_POOL_MAX, 3, 1, 8),
		ssl: tls.ssl,
	});
	pool.on("error", (error) =>
		logOpsError("dining postgres pool error", error, { source: "dining" }),
	);
	return createDiningStore(pool);
}

export function createDiningStore(pool: DiningPool): DiningStore {
	return {
		...createDiningPublicationStore(pool),
		...createDiningReviewStore(pool),
		async verifyReadiness() {
			await pool.query("SELECT 1 FROM dining.publication LIMIT 1");
		},
		async getOverview() {
			const [draft, publication, releaseCount, reviewCounts, source] = await Promise.all([
				loadDiningDraft(pool),
				loadDiningPublication(pool),
				pool.query("SELECT count(*)::int AS count FROM dining.releases"),
				pool.query(`SELECT
					count(*) FILTER (WHERE visibility = 'published')::int AS published,
					count(*) FILTER (WHERE visibility = 'hidden')::int AS hidden,
					count(*) FILTER (WHERE moderation_status <> 'safe')::int AS blocked
					FROM dining.reviews`),
				pool.query(`SELECT
					(SELECT max(started_at) FROM dining.source_sync_runs) AS latest_run_at,
					(SELECT count(*)::int FROM dining.source_observations AS observation
					 CROSS JOIN dining.catalog_state AS state WHERE state.scope = 'global'
					 AND observation.source_type = 'feishu_catalog' AND observation.stale_at IS NULL
					 AND observation.status = 'accepted' AND observation.last_seen_at > state.updated_at) AS pending`),
			]);
			return overviewFromRows(
				draft,
				publication,
				releaseCount.rows[0],
				reviewCounts.rows[0],
				source.rows[0],
			);
		},
		async listSourceRuns(limit) {
			const result = await pool.query(
				"SELECT * FROM dining.source_sync_runs ORDER BY started_at DESC LIMIT $1",
				[limit],
			);
			return result.rows.map((row) => ({
				acceptedCount: Number(row.accepted_count),
				blockedCount: Number(row.blocked_count),
				completedAt: diningDateIsoOrNull(row.completed_at),
				runId: String(row.run_id),
				sourceType: String(row.source_type),
				staleCount: Number(row.stale_count),
				startedAt: diningDateIso(row.started_at),
				status: String(row.status),
				totalCount: Number(row.total_count),
			}));
		},
		async listObservations(limit) {
			const result = await pool.query(
				"SELECT * FROM dining.source_observations ORDER BY last_seen_at DESC LIMIT $1",
				[limit],
			);
			return result.rows.map((row) => ({
				observationId: String(row.observation_id),
				observedAt: diningDateIso(row.observed_at),
				payloadJson: diningRecord(row.payload_json),
				sourceType: diningSourceType(row.source_type),
				staleAt: diningDateIsoOrNull(row.stale_at),
				status: diningObservationStatus(row.status),
				targetId: typeof row.target_id === "string" ? row.target_id : null,
				targetKind: diningTargetKind(row.target_kind),
			}));
		},
	};
}

function overviewFromRows(
	draft: DiningDraft,
	publication: DiningPublication,
	release: Record<string, unknown> | undefined,
	reviews: Record<string, unknown> | undefined,
	source: Record<string, unknown> | undefined,
): DiningOpsOverview {
	return {
		draft: {
			baseReleaseId: draft.baseReleaseId,
			revision: draft.revision,
			updatedAt: draft.updatedAt,
			updatedBy: draft.updatedBy,
		},
		publication,
		releases: Number(release?.count ?? 0),
		reviews: {
			blocked: Number(reviews?.blocked ?? 0),
			hidden: Number(reviews?.hidden ?? 0),
			published: Number(reviews?.published ?? 0),
		},
		source: {
			latestRunAt: diningDateIsoOrNull(source?.latest_run_at),
			pendingCatalogObservations: Number(source?.pending ?? 0),
		},
	};
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

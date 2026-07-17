import { createHash, randomUUID } from "node:crypto";
import {
	assertDiningSnapshotFloorplanCompatibility,
	type DiningDraft,
	type DiningOpsActor,
	type DiningPublication,
	type DiningPublishedSnapshot,
	type DiningRelease,
	type DiningReleaseDetail,
	type DiningSourceObservation,
	materializeDiningCatalog,
	publicationAfterCatalogPublish,
	publishDiningDraft,
	validateDiningDraft,
} from "@campus-agent/dining/domain";
import { Pool, type PoolClient } from "pg";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";

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

export interface DiningOpsReview {
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	moderationStatus: string;
	offeringId: string | null;
	rating: number | null;
	reviewId: string;
	stallName: string;
	submittedAt: string;
	visibility: string;
}

export type DiningCatalogCommand =
	| { kind: "rename_stall"; stallProfileId: string; displayName: string }
	| { kind: "set_offering_price"; offeringId: string; priceLabel: string | null }
	| {
			kind: "assign_stall";
			windowId: string;
			stallProfileId: string;
			displayName: string;
			tags: string[];
	  }
	| { kind: "remove_assignment"; assignmentId: string };

export type DiningReviewCommand =
	| { kind: "hide"; reason: string }
	| { kind: "restore"; reason: string }
	| { kind: "rebind"; offeringId: string; reason: string }
	| { kind: "recheck" };

export interface DiningStore {
	applyCatalogCommand(actor: DiningOpsActor, command: DiningCatalogCommand): Promise<DiningDraft>;
	applyReviewCommand(
		actor: DiningOpsActor,
		reviewId: string,
		command: DiningReviewCommand,
	): Promise<void>;
	getDraft(): Promise<DiningDraft>;
	getOverview(): Promise<DiningOpsOverview>;
	getRelease(releaseId: string): Promise<DiningReleaseDetail | null>;
	getReview(reviewId: string): Promise<DiningOpsReview | null>;
	listObservations(limit: number): Promise<DiningOpsObservation[]>;
	listReleases(): Promise<DiningRelease[]>;
	listReviews(limit: number): Promise<DiningOpsReview[]>;
	listSourceRuns(limit: number): Promise<DiningOpsSourceRun[]>;
	publish(actor: DiningOpsActor, notes: string): Promise<DiningReleaseDetail>;
	rebase(actor: DiningOpsActor): Promise<DiningDraft>;
	rollback(actor: DiningOpsActor, releaseId: string, notes: string): Promise<DiningReleaseDetail>;
	validate(): Promise<ReturnType<typeof validateDiningDraft>>;
	verifyReadiness(): Promise<void>;
}

export interface DiningStoreEnv {
	OPS_WEB_DINING_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_DINING_DATABASE_SSLMODE?: string;
	OPS_WEB_DINING_DATABASE_URL?: string;
	OPS_WEB_DINING_DB_POOL_MAX?: string;
}

export class DiningStoreUnavailableError extends Error {
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
		throw new Error("OPS_WEB_DINING_DATABASE_URL is required.");
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
	pool.on("error", (error) => console.error("[ops-web] dining postgres pool error", error));
	return createDiningStore(pool);
}

export function createDiningStore(pool: Pick<Pool, "connect" | "query">): DiningStore {
	return {
		async verifyReadiness() {
			await pool.query("SELECT 1 FROM dining.publication LIMIT 1");
		},
		async getDraft() {
			return loadDraft(pool);
		},
		async validate() {
			return validateDiningDraft(await loadDraft(pool));
		},
		async getOverview() {
			const [draft, publication, releaseCount, reviewCounts, source] = await Promise.all([
				loadDraft(pool),
				loadPublication(pool),
				pool.query("SELECT count(*)::int AS count FROM dining.releases"),
				pool.query(`SELECT
					count(*) FILTER (WHERE visibility = 'published')::int AS published,
					count(*) FILTER (WHERE visibility = 'hidden')::int AS hidden,
					count(*) FILTER (WHERE moderation_status <> 'safe')::int AS blocked
					FROM dining.reviews`),
				pool.query(`SELECT
						(SELECT max(started_at) FROM dining.source_sync_runs) AS latest_run_at,
						(SELECT count(*)::int
							FROM dining.source_observations AS observation
							CROSS JOIN dining.catalog_state AS state
							WHERE state.scope = 'global'
								AND observation.source_type = 'feishu_catalog'
								AND observation.stale_at IS NULL
								AND observation.status = 'accepted'
								AND observation.last_seen_at > state.updated_at) AS pending`),
			]);
			return {
				draft: {
					baseReleaseId: draft.baseReleaseId,
					revision: draft.revision,
					updatedAt: draft.updatedAt,
					updatedBy: draft.updatedBy,
				},
				publication,
				releases: Number(releaseCount.rows[0]?.count ?? 0),
				reviews: {
					blocked: Number(reviewCounts.rows[0]?.blocked ?? 0),
					hidden: Number(reviewCounts.rows[0]?.hidden ?? 0),
					published: Number(reviewCounts.rows[0]?.published ?? 0),
				},
				source: {
					latestRunAt: dateIsoOrNull(source.rows[0]?.latest_run_at),
					pendingCatalogObservations: Number(source.rows[0]?.pending ?? 0),
				},
			};
		},
		async listSourceRuns(limit) {
			const result = await pool.query(
				"SELECT * FROM dining.source_sync_runs ORDER BY started_at DESC LIMIT $1",
				[limit],
			);
			return result.rows.map((row) => ({
				acceptedCount: Number(row.accepted_count),
				blockedCount: Number(row.blocked_count),
				completedAt: dateIsoOrNull(row.completed_at),
				runId: String(row.run_id),
				sourceType: String(row.source_type),
				staleCount: Number(row.stale_count),
				startedAt: dateIso(row.started_at),
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
				observedAt: dateIso(row.observed_at),
				payloadJson: record(row.payload_json),
				sourceType: sourceType(row.source_type),
				staleAt: dateIsoOrNull(row.stale_at),
				status: observationStatus(row.status),
				targetId: typeof row.target_id === "string" ? row.target_id : null,
				targetKind: targetKind(row.target_kind),
			}));
		},
		async rebase(actor) {
			return withTransaction(pool, async (client) => {
				const current = await loadDraft(client);
				const observations = await loadCatalogObservations(client);
				const draft = materializeDiningCatalog({
					actorId: actor.principalId,
					baseReleaseId: current.baseReleaseId,
					currentRevision: current.revision,
					now: new Date().toISOString(),
					observations,
				});
				for (const override of await loadCatalogOverrides(client)) {
					applyStoredOverride(draft, override);
				}
				await replaceDraft(client, draft);
				await writeEvent(client, actor, "catalog.rebased", "catalog", "global", {
					revision: draft.revision,
				});
				return draft;
			});
		},
		async applyCatalogCommand(actor, command) {
			return withTransaction(pool, async (client) => {
				const draft = await loadDraft(client);
				applyCommand(draft, command);
				draft.revision += 1;
				draft.updatedAt = new Date().toISOString();
				draft.updatedBy = actor.principalId;
				await replaceDraft(client, draft);
				await saveCatalogOverride(client, actor, command);
				await writeEvent(client, actor, `catalog.${command.kind}`, "catalog", "global", {
					revision: draft.revision,
				});
				return draft;
			});
		},
		async publish(actor, notes) {
			return withTransaction(pool, async (client) => {
				const draft = await loadDraft(client);
				const result = publishDiningDraft({
					actor,
					draft,
					notes,
					releaseId: `dining_release:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`,
				});
				await persistRelease(client, result.release, result.snapshot);
				const publication = publicationAfterCatalogPublish({
					current: await loadPublication(client),
					releaseId: result.release.releaseId,
					updatedAt: result.release.createdAt,
				});
				await savePublication(client, publication);
				await client.query(
					"UPDATE dining.catalog_state SET base_release_id=$1 WHERE scope='global'",
					[result.release.releaseId],
				);
				await retainLatestReleases(client);
				await writeEvent(client, actor, "catalog.published", "release", result.release.releaseId, {
					revision: draft.revision,
				});
				return { release: result.release, snapshot: result.snapshot };
			});
		},
		async listReleases() {
			const result = await pool.query("SELECT * FROM dining.releases ORDER BY created_at DESC");
			return result.rows.map(rowToRelease);
		},
		async getRelease(releaseId) {
			const result = await pool.query("SELECT * FROM dining.releases WHERE release_id=$1", [
				releaseId,
			]);
			return result.rows[0] ? rowToReleaseDetail(result.rows[0]) : null;
		},
		async rollback(actor, releaseId, notes) {
			return withTransaction(pool, async (client) => {
				const target = await client.query("SELECT * FROM dining.releases WHERE release_id=$1", [
					releaseId,
				]);
				if (!target.rows[0]) {
					throw new DiningStoreNotFoundError("release");
				}
				const publication = await loadPublication(client);
				const rollback = buildDiningRollback({
					actor,
					notes,
					predecessorReleaseId: publication.catalogReleaseId,
					target: rowToReleaseDetail(target.rows[0]),
				});
				const { release, snapshot: rollbackSnapshot } = rollback;
				const rollbackId = release.releaseId;
				await persistRelease(client, release, rollbackSnapshot);
				await savePublication(client, {
					...publication,
					catalogReleaseId: rollbackId,
					updatedAt: release.createdAt,
				});
				await client.query(
					"UPDATE dining.catalog_state SET base_release_id=$1 WHERE scope='global'",
					[rollbackId],
				);
				await retainLatestReleases(client);
				await writeEvent(client, actor, "catalog.rolled_back", "release", rollbackId, {
					rollbackOfReleaseId: releaseId,
				});
				return rollback;
			});
		},
		async listReviews(limit) {
			return listReviews(pool, limit);
		},
		async getReview(reviewId) {
			const result = await pool.query("SELECT * FROM dining.reviews WHERE review_id=$1", [
				reviewId,
			]);
			return result.rows[0] ? rowToReview(result.rows[0]) : null;
		},
		async applyReviewCommand(actor, reviewId, command) {
			await withTransaction(pool, async (client) => {
				const before = await publishedReviewDigest(client, reviewId);
				const review = await client.query(
					`SELECT review_id,moderation_status,hall_id,stall_profile_id,window_id,offering_id
							FROM dining.reviews WHERE review_id=$1`,
					[reviewId],
				);
				if (!review.rows[0]) {
					throw new DiningStoreNotFoundError("review");
				}
				if (
					command.kind === "restore" &&
					(review.rows[0].moderation_status !== "safe" ||
						!review.rows[0].hall_id ||
						!review.rows[0].stall_profile_id ||
						!review.rows[0].window_id ||
						!review.rows[0].offering_id)
				) {
					throw new DiningStoreValidationError(
						"Only safe reviews with an exact offering binding can be restored.",
					);
				}
				let binding: ReviewOfferingBinding | null = null;
				if (command.kind === "rebind") {
					binding = await loadReviewOfferingBinding(client, command.offeringId);
					if (!binding) {
						throw new DiningStoreValidationError(
							"Review target offering does not exist in the current draft.",
						);
					}
				}
				if (command.kind === "recheck") {
					await client.query(
						"INSERT INTO dining.review_recheck_requests(request_id,review_id,status,requested_at,requested_by) VALUES($1,$2,'pending',now(),$3)",
						[`review_recheck:${randomUUID()}`, reviewId, actor.principalId],
					);
				} else {
					const offeringId = command.kind === "rebind" ? command.offeringId : null;
					const visibility =
						command.kind === "hide" ? "hidden" : command.kind === "restore" ? "published" : null;
					await client.query(
						`INSERT INTO dining.review_overrides(review_id,offering_id,visibility,reason,updated_at,updated_by)
						VALUES($1,$2,$3,$4,now(),$5) ON CONFLICT(review_id) DO UPDATE SET
						offering_id=COALESCE(EXCLUDED.offering_id,dining.review_overrides.offering_id),
						visibility=COALESCE(EXCLUDED.visibility,dining.review_overrides.visibility),
						reason=EXCLUDED.reason,updated_at=now(),updated_by=EXCLUDED.updated_by`,
						[reviewId, offeringId, visibility, command.reason, actor.principalId],
					);
					if (binding) {
						await client.query(
							`UPDATE dining.reviews SET
									hall_id=$1,stall_profile_id=$2,window_id=$3,offering_id=$4,updated_at=now()
									WHERE review_id=$5`,
							[
								binding.hallId,
								binding.stallProfileId,
								binding.windowId,
								binding.offeringId,
								reviewId,
							],
						);
					}
					if (visibility) {
						await client.query(
							"UPDATE dining.reviews SET visibility=$1,published_at=CASE WHEN $1='published' THEN COALESCE(published_at,now()) ELSE NULL END,updated_at=now() WHERE review_id=$2",
							[visibility, reviewId],
						);
					}
					const after = await publishedReviewDigest(client, reviewId);
					if (before !== after) {
						await client.query(
							"UPDATE dining.publication SET review_revision=review_revision+1,updated_at=now() WHERE scope='global'",
						);
					}
				}
				await writeEvent(client, actor, `review.${command.kind}`, "review", reviewId, {});
			});
		},
	};
}

interface ReviewOfferingBinding {
	hallId: string;
	offeringId: string;
	stallProfileId: string;
	windowId: string;
}

export async function loadReviewOfferingBinding(
	db: Pick<Pool, "query">,
	offeringId: string,
): Promise<ReviewOfferingBinding | null> {
	const result = await db.query(
		`SELECT offering.offering_id, assignment.stall_profile_id, assignment.window_id, window.hall_id
			FROM dining.menu_offerings AS offering
			JOIN dining.window_assignments AS assignment
				ON assignment.assignment_id = offering.assignment_id
			JOIN dining.windows AS window ON window.window_id = assignment.window_id
			WHERE offering.offering_id = $1`,
		[offeringId],
	);
	const row = result.rows[0];
	return row
		? {
				hallId: String(row.hall_id),
				offeringId: String(row.offering_id),
				stallProfileId: String(row.stall_profile_id),
				windowId: String(row.window_id),
			}
		: null;
}

async function publishedReviewDigest(db: Pick<Pool, "query">, reviewId: string): Promise<string> {
	const result = await db.query(
		`SELECT CASE WHEN visibility = 'published' AND moderation_status = 'safe' THEN
			jsonb_build_array(
				review_id,comment,contributor_name,images_json,paid_price_label,rating,submitted_at,
				hall_id,stall_profile_id,window_id,offering_id
			)::text ELSE 'hidden' END AS value
			FROM dining.reviews WHERE review_id = $1`,
		[reviewId],
	);
	return String(result.rows[0]?.value ?? "missing");
}

export class DiningStoreNotFoundError extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`Dining ${kind} was not found.`);
		this.kind = kind;
	}
}
export class DiningStoreValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiningStoreValidationError";
	}
}

async function withTransaction<T>(
	pool: Pick<Pool, "connect">,
	work: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await work(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function loadPublication(db: Pick<Pool, "query">): Promise<DiningPublication> {
	const result = await db.query("SELECT * FROM dining.publication WHERE scope='global'");
	const row = result.rows[0];
	return row
		? {
				catalogReleaseId: row.catalog_release_id ?? null,
				reviewRevision: Number(row.review_revision),
				updatedAt: dateIso(row.updated_at),
			}
		: { catalogReleaseId: null, reviewRevision: 0, updatedAt: new Date(0).toISOString() };
}

async function savePublication(db: Pick<Pool, "query">, publication: DiningPublication) {
	await db.query(
		`INSERT INTO dining.publication(scope,catalog_release_id,review_revision,updated_at) VALUES('global',$1,$2,$3)
		ON CONFLICT(scope) DO UPDATE SET catalog_release_id=EXCLUDED.catalog_release_id,review_revision=EXCLUDED.review_revision,updated_at=EXCLUDED.updated_at`,
		[publication.catalogReleaseId, publication.reviewRevision, new Date(publication.updatedAt)],
	);
}

async function loadDraft(db: Pick<Pool, "query">): Promise<DiningDraft> {
	const [state, halls, floors, windows, stalls, assignments, items, offerings] = await Promise.all([
		db.query("SELECT * FROM dining.catalog_state WHERE scope='global'"),
		db.query("SELECT * FROM dining.halls ORDER BY campus,hall_id"),
		db.query("SELECT * FROM dining.floors ORDER BY sort_key,floor_id"),
		db.query("SELECT * FROM dining.windows ORDER BY window_id"),
		db.query("SELECT * FROM dining.stall_profiles ORDER BY stall_profile_id"),
		db.query("SELECT * FROM dining.window_assignments ORDER BY assignment_id"),
		db.query("SELECT * FROM dining.menu_items ORDER BY menu_item_id"),
		db.query("SELECT * FROM dining.menu_offerings ORDER BY offering_id"),
	]);
	const stateRow = state.rows[0];
	if (!stateRow) {
		throw new Error("Dining catalog_state is missing.");
	}
	return {
		baseReleaseId: stateRow.base_release_id ?? null,
		revision: Number(stateRow.draft_revision),
		updatedAt: dateIso(stateRow.updated_at),
		updatedBy: String(stateRow.updated_by),
		halls: halls.rows.map((hall) => ({
			campus: String(hall.campus),
			hallId: String(hall.hall_id),
			name: String(hall.name),
			status: "active" as const,
			floors: floors.rows
				.filter((floor) => floor.hall_id === hall.hall_id)
				.map((floor) => ({
					floorId: String(floor.floor_id),
					floorplan: {
						floorplanId: String(floor.floorplan_id),
						kind: floorplanKind(floor.floorplan_kind),
					},
					label: String(floor.label),
				})),
		})),
		windows: windows.rows.map((row) => ({
			floorId: String(row.floor_id),
			hallId: String(row.hall_id),
			label: String(row.label),
			locationLabel: String(row.location_label),
			svgAnchorId: row.svg_anchor_id ?? null,
			status: windowStatus(row.status),
			tags: stringArray(row.tags_json),
			windowId: String(row.window_id),
		})),
		stallProfiles: stalls.rows.map((row) => ({
			displayName: String(row.display_name),
			stallProfileId: String(row.stall_profile_id),
			stallType: String(row.stall_type),
			status: "active" as const,
			tags: stringArray(row.tags_json),
		})),
		assignments: assignments.rows.map((row) => ({
			assignmentId: String(row.assignment_id),
			stallProfileId: String(row.stall_profile_id),
			status: "active" as const,
			windowId: String(row.window_id),
		})),
		menuItems: items.rows.map((row) => ({
			menuItemId: String(row.menu_item_id),
			name: String(row.name),
			status: "active" as const,
			tags: stringArray(row.tags_json),
		})),
		menuOfferings: offerings.rows.map((row) => ({
			assignmentId: String(row.assignment_id),
			menuItemId: String(row.menu_item_id),
			offeringId: String(row.offering_id),
			priceLabel: row.price_label ?? null,
		})),
	};
}

async function replaceDraft(client: PoolClient, draft: DiningDraft) {
	for (const table of [
		"menu_offerings",
		"menu_items",
		"window_assignments",
		"stall_profiles",
		"windows",
		"floors",
		"halls",
	]) {
		await client.query(`DELETE FROM dining.${table}`);
	}
	const now = new Date(draft.updatedAt);
	for (const hall of draft.halls) {
		await client.query("INSERT INTO dining.halls VALUES($1,$2,$3,$4,$5,$5)", [
			hall.hallId,
			hall.campus,
			hall.name,
			hall.status,
			now,
		]);
		for (const [index, floor] of hall.floors.entries()) {
			await client.query(
				"INSERT INTO dining.floors(floor_id,hall_id,label,floorplan_kind,floorplan_id,sort_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
				[
					floor.floorId,
					hall.hallId,
					floor.label,
					floor.floorplan.kind,
					floor.floorplan.floorplanId,
					String(index).padStart(4, "0"),
					now,
				],
			);
		}
	}
	for (const row of draft.windows) {
		await client.query(
			"INSERT INTO dining.windows(window_id,hall_id,floor_id,label,location_label,svg_anchor_id,tags_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
			[
				row.windowId,
				row.hallId,
				row.floorId,
				row.label,
				row.locationLabel,
				row.svgAnchorId,
				JSON.stringify(row.tags),
				row.status,
				now,
			],
		);
	}
	for (const row of draft.stallProfiles) {
		await client.query("INSERT INTO dining.stall_profiles VALUES($1,$2,$3,$4,$5,$6,$6)", [
			row.stallProfileId,
			row.displayName,
			row.stallType,
			JSON.stringify(row.tags),
			row.status,
			now,
		]);
	}
	for (const row of draft.assignments) {
		await client.query("INSERT INTO dining.window_assignments VALUES($1,$2,$3,$4,$5,$5)", [
			row.assignmentId,
			row.windowId,
			row.stallProfileId,
			row.status,
			now,
		]);
	}
	for (const row of draft.menuItems) {
		await client.query("INSERT INTO dining.menu_items VALUES($1,$2,$3,$4,$5,$5)", [
			row.menuItemId,
			row.name,
			JSON.stringify(row.tags),
			row.status,
			now,
		]);
	}
	for (const row of draft.menuOfferings) {
		await client.query("INSERT INTO dining.menu_offerings VALUES($1,$2,$3,$4,$5,$5)", [
			row.offeringId,
			row.assignmentId,
			row.menuItemId,
			row.priceLabel,
			now,
		]);
	}
	await client.query(
		`INSERT INTO dining.catalog_state(scope,draft_revision,base_release_id,updated_at,updated_by) VALUES('global',$1,$2,$3,$4)
		ON CONFLICT(scope) DO UPDATE SET draft_revision=EXCLUDED.draft_revision,base_release_id=EXCLUDED.base_release_id,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by`,
		[draft.revision, draft.baseReleaseId, now, draft.updatedBy],
	);
}

async function loadCatalogObservations(
	db: Pick<Pool, "query">,
): Promise<DiningSourceObservation[]> {
	const result = await db.query(
		"SELECT * FROM dining.source_observations WHERE source_type='feishu_catalog' AND stale_at IS NULL ORDER BY target_kind,observation_id",
	);
	return result.rows.map((row) => ({
		observationId: String(row.observation_id),
		observedAt: dateIso(row.observed_at),
		payloadJson: record(row.payload_json),
		sourceType: "feishu_catalog",
		status: observationStatus(row.status),
		targetId: row.target_id ?? null,
		targetKind: targetKind(row.target_kind),
	}));
}

async function persistRelease(client: PoolClient, release: DiningRelease, snapshot: unknown) {
	await client.query(
		`INSERT INTO dining.releases(release_id,predecessor_release_id,rollback_of_release_id,draft_revision,notes,snapshot_hash,payload_json,validation_json,created_at,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		[
			release.releaseId,
			release.predecessorReleaseId,
			release.rollbackOfReleaseId,
			release.draftRevision,
			release.notes,
			release.snapshotHash,
			JSON.stringify(snapshot),
			JSON.stringify(release.validation),
			new Date(release.createdAt),
			release.createdBy,
		],
	);
}

export async function retainLatestReleases(client: Pick<PoolClient, "query">) {
	await client.query(`DELETE FROM dining.releases WHERE release_id IN (
		SELECT release_id FROM dining.releases ORDER BY created_at DESC OFFSET 30
	) AND release_id IS DISTINCT FROM (SELECT catalog_release_id FROM dining.publication WHERE scope='global')`);
}

function applyCommand(draft: DiningDraft, command: DiningCatalogCommand) {
	if (command.kind === "rename_stall") {
		const item = draft.stallProfiles.find((x) => x.stallProfileId === command.stallProfileId);
		if (!item) {
			throw new DiningStoreNotFoundError("stall");
		}
		item.displayName = command.displayName;
		return;
	}
	if (command.kind === "set_offering_price") {
		const item = draft.menuOfferings.find((x) => x.offeringId === command.offeringId);
		if (!item) {
			throw new Error("Dining offering was not found.");
		}
		item.priceLabel = command.priceLabel;
		return;
	}
	if (command.kind === "remove_assignment") {
		if (!draft.assignments.some((item) => item.assignmentId === command.assignmentId)) {
			throw new DiningStoreNotFoundError("assignment");
		}
		draft.assignments = draft.assignments.filter((x) => x.assignmentId !== command.assignmentId);
		draft.menuOfferings = draft.menuOfferings.filter(
			(x) => x.assignmentId !== command.assignmentId,
		);
		return;
	}
	if (!draft.windows.some((x) => x.windowId === command.windowId)) {
		throw new Error("Dining window was not found.");
	}
	const replacedAssignmentIds = new Set(
		draft.assignments
			.filter((assignment) => assignment.windowId === command.windowId)
			.map((assignment) => assignment.assignmentId),
	);
	let stall = draft.stallProfiles.find((x) => x.stallProfileId === command.stallProfileId);
	if (!stall) {
		stall = {
			displayName: command.displayName,
			stallProfileId: command.stallProfileId,
			stallType: "food_window",
			status: "active",
			tags: command.tags,
		};
		draft.stallProfiles.push(stall);
	}
	draft.assignments = draft.assignments.filter((x) => x.windowId !== command.windowId);
	draft.menuOfferings = draft.menuOfferings.filter(
		(offering) => !replacedAssignmentIds.has(offering.assignmentId),
	);
	draft.assignments.push({
		assignmentId: `assignment:${command.windowId}:${command.stallProfileId}`,
		stallProfileId: command.stallProfileId,
		status: "active",
		windowId: command.windowId,
	});
}

export interface StoredCatalogOverride {
	patch: Record<string, unknown>;
	targetId: string;
	targetKind: string;
}

async function loadCatalogOverrides(db: Pick<Pool, "query">): Promise<StoredCatalogOverride[]> {
	const result = await db.query(
		"SELECT target_kind,target_id,patch_json FROM dining.catalog_overrides WHERE active ORDER BY created_at",
	);
	return result.rows.map((row) => ({
		patch: record(row.patch_json),
		targetId: String(row.target_id),
		targetKind: String(row.target_kind),
	}));
}

export function applyStoredOverride(draft: DiningDraft, override: StoredCatalogOverride) {
	if (override.targetKind === "stall") {
		const stall = draft.stallProfiles.find((item) => item.stallProfileId === override.targetId);
		if (stall && typeof override.patch.displayName === "string") {
			stall.displayName = override.patch.displayName;
		}
		return;
	}
	if (override.targetKind === "offering") {
		const offering = draft.menuOfferings.find((item) => item.offeringId === override.targetId);
		if (
			offering &&
			(typeof override.patch.priceLabel === "string" || override.patch.priceLabel === null)
		) {
			offering.priceLabel = override.patch.priceLabel;
		}
		return;
	}
	if (override.targetKind === "assignment" && override.patch.removed === true) {
		draft.assignments = draft.assignments.filter((item) => item.assignmentId !== override.targetId);
		draft.menuOfferings = draft.menuOfferings.filter(
			(item) => item.assignmentId !== override.targetId,
		);
		return;
	}
	if (override.targetKind === "window" && isAssignPatch(override.patch)) {
		applyCommand(draft, { kind: "assign_stall", ...override.patch });
	}
}

async function saveCatalogOverride(
	client: PoolClient,
	actor: DiningOpsActor,
	command: DiningCatalogCommand,
) {
	const targetKind =
		command.kind === "rename_stall"
			? "stall"
			: command.kind === "set_offering_price"
				? "offering"
				: command.kind === "remove_assignment"
					? "assignment"
					: "window";
	const targetId =
		command.kind === "rename_stall"
			? command.stallProfileId
			: command.kind === "set_offering_price"
				? command.offeringId
				: command.kind === "remove_assignment"
					? command.assignmentId
					: command.windowId;
	const patch =
		command.kind === "rename_stall"
			? { displayName: command.displayName }
			: command.kind === "set_offering_price"
				? { priceLabel: command.priceLabel }
				: command.kind === "remove_assignment"
					? { removed: true }
					: {
							displayName: command.displayName,
							stallProfileId: command.stallProfileId,
							tags: command.tags,
							windowId: command.windowId,
						};
	await client.query(
		`INSERT INTO dining.catalog_overrides(override_id,target_kind,target_id,patch_json,reason,active,created_at,updated_at,updated_by)
		VALUES($1,$2,$3,$4,'ops edit',true,now(),now(),$5)
		ON CONFLICT(override_id) DO UPDATE SET patch_json=EXCLUDED.patch_json,active=true,updated_at=now(),updated_by=EXCLUDED.updated_by`,
		[
			`override:${targetKind}:${targetId}`,
			targetKind,
			targetId,
			JSON.stringify(patch),
			actor.principalId,
		],
	);
}

function isAssignPatch(value: Record<string, unknown>): value is {
	displayName: string;
	stallProfileId: string;
	tags: string[];
	windowId: string;
} {
	return (
		typeof value.displayName === "string" &&
		typeof value.stallProfileId === "string" &&
		typeof value.windowId === "string" &&
		Array.isArray(value.tags) &&
		value.tags.every((item) => typeof item === "string")
	);
}

async function writeEvent(
	client: PoolClient,
	actor: DiningOpsActor,
	action: string,
	objectKind: string,
	objectId: string,
	summary: Record<string, unknown>,
) {
	await client.query("INSERT INTO dining.operation_events VALUES($1,$2,$3,$4,$5,$6,now())", [
		`dining_event:${randomUUID()}`,
		action,
		actor.principalId,
		objectKind,
		objectId,
		JSON.stringify(summary),
	]);
}

async function listReviews(db: Pick<Pool, "query">, limit: number): Promise<DiningOpsReview[]> {
	const result = await db.query(
		"SELECT * FROM dining.reviews ORDER BY submitted_at DESC LIMIT $1",
		[limit],
	);
	return result.rows.map(rowToReview);
}
function rowToReview(row: Record<string, unknown>): DiningOpsReview {
	return {
		comment: typeof row.comment === "string" ? row.comment : null,
		contributorName: typeof row.contributor_name === "string" ? row.contributor_name : null,
		dishName: String(row.dish_name),
		moderationStatus: String(row.moderation_status),
		offeringId: typeof row.offering_id === "string" ? row.offering_id : null,
		rating: typeof row.rating === "number" ? row.rating : null,
		reviewId: String(row.review_id),
		stallName: String(row.stall_name),
		submittedAt: dateIso(row.submitted_at),
		visibility: String(row.visibility),
	};
}
function rowToRelease(row: Record<string, unknown>): DiningRelease {
	return {
		createdAt: dateIso(row.created_at),
		createdBy: String(row.created_by),
		draftRevision: Number(row.draft_revision),
		notes: String(row.notes),
		predecessorReleaseId:
			typeof row.predecessor_release_id === "string" ? row.predecessor_release_id : null,
		releaseId: String(row.release_id),
		rollbackOfReleaseId:
			typeof row.rollback_of_release_id === "string" ? row.rollback_of_release_id : null,
		snapshotHash: String(row.snapshot_hash),
		validation: record(row.validation_json) as never,
	};
}
function rowToReleaseDetail(row: Record<string, unknown>): DiningReleaseDetail {
	return { release: rowToRelease(row), snapshot: record(row.payload_json) as never };
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected object from Dining database.");
	}
	return value as Record<string, unknown>;
}
function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
function dateIso(value: unknown): string {
	const date = value instanceof Date ? value : new Date(String(value));
	if (!Number.isFinite(date.getTime())) {
		throw new Error("Invalid Dining timestamp.");
	}
	return date.toISOString();
}
function dateIsoOrNull(value: unknown): string | null {
	return value === null || value === undefined ? null : dateIso(value);
}
function sourceType(value: unknown): DiningSourceObservation["sourceType"] {
	if (value === "feishu_catalog" || value === "feishu_review") {
		return value;
	}
	throw new Error("Invalid Dining source type.");
}
function observationStatus(value: unknown): DiningSourceObservation["status"] {
	if (value === "accepted" || value === "blocked" || value === "observed") {
		return value;
	}
	throw new Error("Invalid Dining observation status.");
}
function targetKind(value: unknown): DiningSourceObservation["targetKind"] {
	if (["campus", "hall", "menu_item", "menu_offering", "review", "stall"].includes(String(value))) {
		return value as DiningSourceObservation["targetKind"];
	}
	throw new Error("Invalid Dining target kind.");
}
function windowStatus(value: unknown): DiningDraft["windows"][number]["status"] {
	if (value === "active" || value === "closed" || value === "maintenance") {
		return value;
	}
	throw new Error("Invalid Dining window status.");
}
function floorplanKind(
	value: unknown,
): DiningDraft["halls"][number]["floors"][number]["floorplan"]["kind"] {
	if (value === "asset" || value === "placeholder") {
		return value;
	}
	throw new Error("Invalid Dining floorplan kind.");
}
function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function buildDiningRollback(input: {
	actor: DiningOpsActor;
	notes: string;
	now?: string;
	predecessorReleaseId: string | null;
	releaseId?: string;
	target: DiningReleaseDetail;
}): DiningReleaseDetail {
	assertDiningSnapshotFloorplanCompatibility(input.target.snapshot);
	const now = input.now ?? new Date().toISOString();
	const releaseId =
		input.releaseId ?? `dining_release:${Date.parse(now).toString(36)}:${randomUUID().slice(0, 8)}`;
	const snapshot: DiningPublishedSnapshot = {
		...input.target.snapshot,
		source: { ...input.target.snapshot.source, releaseId, updatedAt: now },
	};
	const release: DiningRelease = {
		...input.target.release,
		createdAt: now,
		createdBy: input.actor.principalId,
		notes: input.notes,
		predecessorReleaseId: input.predecessorReleaseId,
		releaseId,
		rollbackOfReleaseId: input.target.release.releaseId,
		snapshotHash: `sha256:${createHash("sha256").update(stableJson(snapshot)).digest("hex")}`,
	};
	return { release, snapshot };
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

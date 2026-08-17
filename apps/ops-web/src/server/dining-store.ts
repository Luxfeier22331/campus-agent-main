import { randomUUID } from "node:crypto";
import {
	type DiningMapDraft,
	type DiningMapPublication,
	type DiningMapRelease,
	DiningMapResponseSchema,
} from "@campus-agent/dining/domain";
import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
} from "@campus-agent/dining/floorplans";
import {
	buildDiningMapResponse,
	diningMapBundleFingerprint,
	renderDiningMapAssets,
} from "@campus-agent/dining/publisher";
import type { Pool, PoolClient } from "pg";
import type { DiningReleaseSummary } from "../shared/dining-contract.ts";
import type { DiningFloorplanAssetStore } from "./dining-floorplan-assets.ts";
import type { DiningMapStore, DiningOpsActor } from "./dining-store-contract.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store-errors.ts";

const GLOBAL_SCOPE = "global";

export function createPgDiningStore(input: {
	assetStore: DiningFloorplanAssetStore;
	now?: () => Date;
	pool: Pick<Pool, "connect" | "query">;
	releaseId?: () => string;
}): DiningMapStore {
	const now = input.now ?? (() => new Date());
	const nextReleaseId = input.releaseId ?? randomUUID;

	return {
		async getState() {
			return withStoreErrors(async () => {
				const [draft, release] = await Promise.all([
					loadDraft(input.pool),
					loadCurrentRelease(input.pool),
				]);
				return {
					currentRelease: release ? toReleaseSummary(release) : null,
					draft,
				};
			});
		},

		async listReleases() {
			return withStoreErrors(async () => {
				const [publication, result] = await Promise.all([
					loadPublication(input.pool),
					input.pool.query(`
						select release_id, snapshot_hash, draft_revision, kind,
						       restored_from_release_id, created_at, created_by
						from dining.map_releases
						order by created_at desc, release_id desc
					`),
				]);
				return {
					currentReleaseId: publication?.releaseId ?? null,
					releases: result.rows.map(rowToReleaseSummary),
				};
			});
		},

		async saveDraft(actor, bundle, expectedRevision) {
			return withStoreErrors(async () => {
				const canonical = parseBundle(bundle);
				const fingerprint = diningMapBundleFingerprint(canonical);
				return transaction(input.pool, async (client) => {
					const current = await loadDraft(client, true);
					assertExpectedRevision(current, expectedRevision);
					if (current.fingerprint === fingerprint) {
						return current;
					}
					const updatedAt = now().toISOString();
					const revision = current.revision + 1;
					await client.query(
						`update dining.map_draft
						 set bundle_json = $1, fingerprint = $2, revision = $3,
						     updated_at = $4, updated_by = $5
						 where scope = $6`,
						[canonical, fingerprint, revision, updatedAt, actor.principalId, GLOBAL_SCOPE],
					);
					return {
						bundle: canonical,
						fingerprint,
						revision,
						updatedAt,
						updatedBy: actor.principalId,
					};
				});
			});
		},

		async publish(actor, expectedRevision) {
			return withStoreErrors(async () => {
				const candidate = await loadDraft(input.pool);
				assertExpectedRevision(candidate, expectedRevision);
				await assertActiveMenuWindowsExist(input.pool, candidate.bundle);
				const current = await loadCurrentRelease(input.pool);
				if (current?.snapshotHash === candidate.fingerprint) {
					return toReleaseSummary(current);
				}
				const assets = await uploadAssets(input.assetStore, candidate.bundle);
				return transaction(input.pool, async (client) => {
					const lockedDraft = await loadDraft(client, true);
					assertExpectedRevision(lockedDraft, expectedRevision);
					await assertActiveMenuWindowsExist(client, lockedDraft.bundle);
					if (lockedDraft.fingerprint !== candidate.fingerprint) {
						throw new DiningStoreConflictError("地图草稿已被其他操作者更新，请刷新后重试。");
					}
					const lockedCurrent = await loadCurrentRelease(client);
					if (lockedCurrent?.snapshotHash === lockedDraft.fingerprint) {
						return toReleaseSummary(lockedCurrent);
					}
					const release = createRelease({
						actor,
						assets,
						bundle: lockedDraft.bundle,
						draftRevision: lockedDraft.revision,
						kind: "publish",
						now: now(),
						releaseId: nextReleaseId(),
						restoredFromReleaseId: null,
						snapshotHash: lockedDraft.fingerprint,
					});
					await insertRelease(client, release);
					await savePublication(client, actor, release);
					return toReleaseSummary(release);
				});
			});
		},

		async restore(actor, releaseId, expectedRevision) {
			return withStoreErrors(async () => {
				const target = await loadRelease(input.pool, releaseId);
				if (!target) {
					throw new DiningStoreNotFoundError("未找到要恢复的地图版本。");
				}
				await assertActiveMenuWindowsExist(input.pool, target.bundle);
				const assets = await uploadAssets(input.assetStore, target.bundle);
				return transaction(input.pool, async (client) => {
					const draft = await loadDraft(client, true);
					assertExpectedRevision(draft, expectedRevision);
					await assertActiveMenuWindowsExist(client, target.bundle);
					const current = await loadCurrentRelease(client);
					const restoredDraft =
						draft.fingerprint === target.snapshotHash
							? draft
							: await replaceDraft(client, {
									actor,
									bundle: target.bundle,
									fingerprint: target.snapshotHash,
									now: now(),
									revision: draft.revision + 1,
								});
					if (current?.snapshotHash === target.snapshotHash) {
						return { draft: restoredDraft, release: toReleaseSummary(current) };
					}
					const release = createRelease({
						actor,
						assets,
						bundle: target.bundle,
						draftRevision: restoredDraft.revision,
						kind: "restore",
						now: now(),
						releaseId: nextReleaseId(),
						restoredFromReleaseId: target.releaseId,
						snapshotHash: target.snapshotHash,
					});
					await insertRelease(client, release);
					await savePublication(client, actor, release);
					return { draft: restoredDraft, release: toReleaseSummary(release) };
				});
			});
		},

		async verifyReadiness() {
			return withStoreErrors(async () => {
				await Promise.all([
					input.pool.query("select 1 from dining.map_draft limit 1"),
					input.assetStore.verifyReadiness(),
				]);
			});
		},
	};
}

async function assertActiveMenuWindowsExist(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
	bundle: DiningFloorplanBundleV1,
): Promise<void> {
	const availableWindowIds = new Set(
		bundle.layouts.flatMap((layout) =>
			layout.windows.map((window) => `${layout.hallId}:${layout.floorId}:${window.anchorId}`),
		),
	);
	const result = await db.query(
		"select distinct window_id from dining.menu_items where archived_at is null order by window_id",
	);
	const missingWindowIds = result.rows
		.map((row) => String(row.window_id))
		.filter((windowId) => !availableWindowIds.has(windowId));
	if (missingWindowIds.length > 0) {
		throw new DiningStoreConflictError("地图会移除仍有在售菜品的窗口，请先迁移或归档这些菜品。", {
			windowIds: missingWindowIds,
		});
	}
}

export function createUnavailableDiningStore(error: unknown): DiningMapStore {
	const unavailable = async (): Promise<never> => {
		throw new DiningStoreUnavailableError("食堂地图存储不可用。", { cause: error });
	};
	return {
		getState: unavailable,
		listReleases: unavailable,
		publish: unavailable,
		restore: unavailable,
		saveDraft: unavailable,
		verifyReadiness: unavailable,
	};
}

async function uploadAssets(store: DiningFloorplanAssetStore, bundle: DiningFloorplanBundleV1) {
	let assets: ReturnType<typeof renderDiningMapAssets>;
	try {
		assets = renderDiningMapAssets(bundle);
	} catch (error) {
		throw new DiningStoreValidationError(
			error instanceof Error ? error.message : "食堂地图无法发布。",
			{ cause: error },
		);
	}
	try {
		await Promise.all(
			assets.map(async (asset) => {
				const stored = await store.putSvg({ sha256: asset.sha256, svgMarkup: asset.svgMarkup });
				if (stored.sha256 !== asset.sha256 || stored.svgAssetUrl !== asset.svgAssetUrl) {
					throw new Error("Dining floorplan asset identity does not match rendered content.");
				}
			}),
		);
	} catch (error) {
		throw new DiningStoreUnavailableError("食堂地图资源写入失败，公开版本未改变。", {
			cause: error,
		});
	}
	return assets;
}

function createRelease(input: {
	actor: DiningOpsActor;
	assets: ReturnType<typeof renderDiningMapAssets>;
	bundle: DiningFloorplanBundleV1;
	draftRevision: number;
	kind: DiningMapRelease["kind"];
	now: Date;
	releaseId: string;
	restoredFromReleaseId: string | null;
	snapshotHash: `sha256:${string}`;
}): DiningMapRelease {
	const createdAt = input.now.toISOString();
	return {
		bundle: input.bundle,
		createdAt,
		createdBy: input.actor.principalId,
		draftRevision: input.draftRevision,
		kind: input.kind,
		publicPayload: buildDiningMapResponse({
			assets: input.assets,
			bundle: input.bundle,
			releaseId: input.releaseId,
			updatedAt: createdAt,
		}),
		releaseId: input.releaseId,
		restoredFromReleaseId: input.restoredFromReleaseId,
		snapshotHash: input.snapshotHash,
	};
}

async function loadDraft(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
	forUpdate = false,
): Promise<DiningMapDraft> {
	const result = await db.query(
		`select bundle_json, fingerprint, revision, updated_at, updated_by
		 from dining.map_draft where scope = $1${forUpdate ? " for update" : ""}`,
		[GLOBAL_SCOPE],
	);
	const row = result.rows[0];
	if (!row) {
		throw new DiningStoreNotFoundError(
			"食堂地图尚未初始化，请先运行 pnpm --dir apps/ops-web db:bootstrap-dining。",
		);
	}
	const bundle = parseStoredBundle(row.bundle_json);
	const fingerprint = parseHash(row.fingerprint, "draft fingerprint");
	if (diningMapBundleFingerprint(bundle) !== fingerprint) {
		throw new DiningStoreUnavailableError("食堂地图草稿内容与指纹不一致。");
	}
	return {
		bundle,
		fingerprint,
		revision: positiveInteger(row.revision, "draft revision"),
		updatedAt: isoDate(row.updated_at, "draft updated_at"),
		updatedBy: nonEmptyString(row.updated_by, "draft updated_by"),
	};
}

async function loadRelease(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
	releaseId: string,
): Promise<DiningMapRelease | null> {
	const result = await db.query(
		`select release_id, snapshot_hash, draft_revision, kind, restored_from_release_id,
		        bundle_json, public_payload_json, created_at, created_by
		 from dining.map_releases where release_id = $1`,
		[releaseId],
	);
	return result.rows[0] ? rowToRelease(result.rows[0]) : null;
}

async function loadCurrentRelease(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
): Promise<DiningMapRelease | null> {
	const result = await db.query(`
		select release.release_id, release.snapshot_hash, release.draft_revision, release.kind,
		       release.restored_from_release_id, release.bundle_json,
		       release.public_payload_json, release.created_at, release.created_by
		from dining.map_publication publication
		join dining.map_releases release on release.release_id = publication.release_id
		where publication.scope = 'global'
	`);
	return result.rows[0] ? rowToRelease(result.rows[0]) : null;
}

async function loadPublication(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
): Promise<DiningMapPublication | null> {
	const result = await db.query(
		"select release_id, updated_at, updated_by from dining.map_publication where scope = $1",
		[GLOBAL_SCOPE],
	);
	const row = result.rows[0];
	return row
		? {
				releaseId: nonEmptyString(row.release_id, "publication release_id"),
				updatedAt: isoDate(row.updated_at, "publication updated_at"),
				updatedBy: nonEmptyString(row.updated_by, "publication updated_by"),
			}
		: null;
}

async function insertRelease(client: PoolClient, release: DiningMapRelease): Promise<void> {
	await client.query(
		`insert into dining.map_releases
		 (release_id, snapshot_hash, draft_revision, kind, restored_from_release_id,
		  bundle_json, public_payload_json, created_at, created_by)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		[
			release.releaseId,
			release.snapshotHash,
			release.draftRevision,
			release.kind,
			release.restoredFromReleaseId,
			release.bundle,
			release.publicPayload,
			release.createdAt,
			release.createdBy,
		],
	);
}

async function savePublication(
	client: PoolClient,
	actor: DiningOpsActor,
	release: DiningMapRelease,
): Promise<void> {
	await client.query(
		`insert into dining.map_publication (scope, release_id, updated_at, updated_by)
		 values ($1,$2,$3,$4)
		 on conflict (scope) do update set
		 release_id = excluded.release_id,
		 updated_at = excluded.updated_at,
		 updated_by = excluded.updated_by`,
		[GLOBAL_SCOPE, release.releaseId, release.createdAt, actor.principalId],
	);
}

async function replaceDraft(
	client: PoolClient,
	input: {
		actor: DiningOpsActor;
		bundle: DiningFloorplanBundleV1;
		fingerprint: `sha256:${string}`;
		now: Date;
		revision: number;
	},
): Promise<DiningMapDraft> {
	const updatedAt = input.now.toISOString();
	await client.query(
		`update dining.map_draft
		 set bundle_json = $1, fingerprint = $2, revision = $3,
		     updated_at = $4, updated_by = $5
		 where scope = $6`,
		[
			input.bundle,
			input.fingerprint,
			input.revision,
			updatedAt,
			input.actor.principalId,
			GLOBAL_SCOPE,
		],
	);
	return {
		bundle: input.bundle,
		fingerprint: input.fingerprint,
		revision: input.revision,
		updatedAt,
		updatedBy: input.actor.principalId,
	};
}

function rowToRelease(row: Record<string, unknown>): DiningMapRelease {
	const releaseId = nonEmptyString(row.release_id, "release_id");
	const bundle = parseStoredBundle(row.bundle_json);
	const snapshotHash = parseHash(row.snapshot_hash, "snapshot_hash");
	if (diningMapBundleFingerprint(bundle) !== snapshotHash) {
		throw new DiningStoreUnavailableError(`食堂地图版本 ${releaseId} 的内容与指纹不一致。`);
	}
	const publicPayload = DiningMapResponseSchema.parse(row.public_payload_json);
	if (publicPayload.releaseId !== releaseId) {
		throw new DiningStoreUnavailableError(`食堂地图版本 ${releaseId} 的公开标识不一致。`);
	}
	return {
		bundle,
		createdAt: isoDate(row.created_at, "release created_at"),
		createdBy: nonEmptyString(row.created_by, "release created_by"),
		draftRevision: positiveInteger(row.draft_revision, "release draft_revision"),
		kind: row.kind === "publish" || row.kind === "restore" ? row.kind : invalid("release kind"),
		publicPayload,
		releaseId,
		restoredFromReleaseId:
			row.restored_from_release_id === null
				? null
				: nonEmptyString(row.restored_from_release_id, "restored_from_release_id"),
		snapshotHash,
	};
}

function rowToReleaseSummary(row: Record<string, unknown>): DiningReleaseSummary {
	return {
		createdAt: isoDate(row.created_at, "release created_at"),
		createdBy: nonEmptyString(row.created_by, "release created_by"),
		draftRevision: positiveInteger(row.draft_revision, "release draft_revision"),
		kind: row.kind === "publish" || row.kind === "restore" ? row.kind : invalid("release kind"),
		releaseId: nonEmptyString(row.release_id, "release_id"),
		restoredFromReleaseId:
			row.restored_from_release_id === null
				? null
				: nonEmptyString(row.restored_from_release_id, "restored_from_release_id"),
		snapshotHash: parseHash(row.snapshot_hash, "snapshot_hash"),
	};
}

function toReleaseSummary(release: DiningMapRelease): DiningReleaseSummary {
	return {
		createdAt: release.createdAt,
		createdBy: release.createdBy,
		draftRevision: release.draftRevision,
		kind: release.kind,
		releaseId: release.releaseId,
		restoredFromReleaseId: release.restoredFromReleaseId,
		snapshotHash: release.snapshotHash,
	};
}

function parseBundle(value: unknown): DiningFloorplanBundleV1 {
	try {
		return canonicalizeDiningFloorplanBundle(value);
	} catch (error) {
		throw new DiningStoreValidationError(
			error instanceof Error ? error.message : "食堂地图格式无效。",
			{ cause: error },
		);
	}
}

function parseStoredBundle(value: unknown): DiningFloorplanBundleV1 {
	try {
		return canonicalizeDiningFloorplanBundle(value);
	} catch (error) {
		throw new DiningStoreUnavailableError("数据库中的食堂地图格式无效。", { cause: error });
	}
}

function assertExpectedRevision(draft: DiningMapDraft, expectedRevision: number): void {
	if (draft.revision !== expectedRevision) {
		throw new DiningStoreConflictError(
			`地图草稿已更新（当前版本 ${draft.revision}），请刷新后重试。`,
		);
	}
}

async function transaction<T>(
	pool: Pick<Pool, "connect">,
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await callback(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

async function withStoreErrors<T>(callback: () => Promise<T>): Promise<T> {
	try {
		return await callback();
	} catch (error) {
		if (
			error instanceof DiningStoreConflictError ||
			error instanceof DiningStoreNotFoundError ||
			error instanceof DiningStoreUnavailableError ||
			error instanceof DiningStoreValidationError
		) {
			throw error;
		}
		throw new DiningStoreUnavailableError("食堂地图数据库请求失败。", { cause: error });
	}
}

function nonEmptyString(value: unknown, field: string): string {
	if (typeof value === "string" && value.trim()) {
		return value;
	}
	return invalid(field);
}

function positiveInteger(value: unknown, field: string): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : invalid(field);
}

function isoDate(value: unknown, field: string): string {
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.valueOf()) ? invalid(field) : date.toISOString();
}

function parseHash(value: unknown, field: string): `sha256:${string}` {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
		? (value as `sha256:${string}`)
		: invalid(field);
}

function invalid(field: string): never {
	throw new DiningStoreUnavailableError(`数据库中的 ${field} 无效。`);
}

import type { DiningOpsSubmissionDetail } from "@campus-agent/dining/domain";
import type { DiningOpsActor } from "./dining-store-contract.ts";
import {
	type DiningDatabasePool,
	diningTransaction,
	isoDate,
	nullableString,
	withDiningStoreErrors,
} from "./dining-store-database.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store-errors.ts";
import type { DiningSubmissionAssetStore } from "./dining-submission-assets.ts";
import {
	loadOpsSubmissionRow,
	OPS_SUBMISSION_COLUMNS,
	opsPublishedWindowIds,
	photoAvailable,
	projectOpsSubmission,
	resolveSubmissionSnapshot,
	submissionContentAvailable,
	submissionExpired,
} from "./dining-submission-projection.ts";
import type { DiningSubmissionStore } from "./dining-submission-store-contract.ts";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function createPgDiningSubmissionStore(input: {
	pool: DiningDatabasePool;
	assets: DiningSubmissionAssetStore;
	now?: () => Date;
}): DiningSubmissionStore {
	const now = input.now ?? (() => new Date());

	async function mutate(
		actor: DiningOpsActor,
		id: string,
		expectedRevision: number,
		action: "hide" | "unhide" | "delete" | "restore" | "keep",
		resolve = false,
	) {
		return withDiningStoreErrors(() =>
			diningTransaction(input.pool, async (client) => {
				// A shared transaction lock coordinates public transitions with map publication.
				if (action === "unhide" || action === "restore") {
					await client.query(
						"select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))",
					);
				}
				const row = await loadOpsSubmissionRow(client, id, true);
				const at = now();
				const expired = submissionExpired(row, at);
				if (row.status === "purged" || row.purged_at != null) {
					throw new DiningStoreConflictError("投稿内容已清理，不能执行该操作。");
				}
				const repeatedDelete =
					action === "delete" &&
					row.deleted_at != null &&
					row.deleted_by === actor.principalId &&
					isoDate(row.deleted_at) === isoDate(row.updated_at);
				if (
					Number(row.revision) !== expectedRevision &&
					!(repeatedDelete && Number(row.revision) === expectedRevision + 1)
				) {
					throw new DiningStoreConflictError("投稿已更新，请刷新后重试。");
				}
				if (action !== "keep" && row.account_deleting_at != null) {
					throw new DiningStoreConflictError("作者正在注销，不能执行该操作。");
				}
				if (action === "delete" && row.deleted_at != null) {
					return projectOpsSubmission(client, row, at);
				}
				if (action === "restore" && row.deleted_at == null) {
					return projectOpsSubmission(client, row, at);
				}
				if (action !== "keep" && expired) {
					throw new DiningStoreConflictError("投稿已超过恢复期限。");
				}
				if ((action === "hide" || action === "unhide") && row.deleted_at != null) {
					throw new DiningStoreConflictError("软删除投稿不能修改隐藏状态。");
				}
				if (action === "restore" || action === "unhide") {
					if (!(await opsPublishedWindowIds(client)).has(String(row.window_id))) {
						throw new DiningStoreConflictError("所属窗口不在当前公开地图中。");
					}
					const photos = await client.query(
						"select cleanup_started_at, cleanup_status from dining.submission_photos where submission_id = $1 and current = true",
						[id],
					);
					if (
						photos.rows.some(
							(photo) => photo.cleanup_started_at != null || photo.cleanup_status !== "pending",
						)
					) {
						throw new DiningStoreConflictError("投稿图片已开始清理，不能恢复。");
					}
				}
				const changed =
					action === "delete" ||
					action === "restore" ||
					(action === "hide" && row.hidden_at == null) ||
					(action === "unhide" && row.hidden_at != null);
				if (changed) {
					const values: unknown[] = [id, at.toISOString(), actor.principalId];
					let fields: string;
					switch (action) {
						case "delete":
							values.push(new Date(at.valueOf() + RETENTION_MS).toISOString());
							fields = "status = 'deleted', deleted_at = $2, deleted_by = $3, expires_at = $4";
							break;
						case "restore":
							fields =
								"status = case when hidden_at is null then 'public' else 'hidden' end, deleted_at = null, deleted_by = null, expires_at = null";
							break;
						case "hide":
							fields = "status = 'hidden', hidden_at = $2, hidden_by = $3";
							break;
						default:
							fields = "status = 'public', hidden_at = null, hidden_by = null";
					}
					await client.query(
						`update dining.submissions set ${fields}, revision = revision + 1, updated_at = $2, updated_by = $3 where submission_id = $1`,
						values,
					);
				}
				if (resolve || action === "hide") {
					await client.query(
						"update dining.submission_reports set resolution = $2, resolved_at = $3, resolved_by = $4 where submission_id = $1 and resolved_at is null",
						[id, action === "keep" ? "keep" : "hide", at.toISOString(), actor.principalId],
					);
				}
				return projectOpsSubmission(client, await loadOpsSubmissionRow(client, id), at);
			}),
		);
	}

	return {
		async listSubmissions(filters) {
			return withDiningStoreErrors(async () => {
				const at = now();
				const values: unknown[] = [at.toISOString()];
				const clauses: string[] = [];
				const add = (sql: string, value: unknown) => {
					values.push(value);
					clauses.push(sql.replace("?", `$${values.length}`));
				};
				if (filters.windowId) {
					add("window_id = ?", filters.windowId);
				}
				if (filters.status) {
					add(
						"(case when status = 'deleted' and expires_at <= $1 then 'expired' else status end) = ?",
						filters.status,
					);
				}
				if (filters.reportStatus) {
					clauses.push(
						`exists (select 1 from dining.submission_reports report where report.submission_id = submission.submission_id and resolved_at is ${filters.reportStatus === "pending" ? "null" : "not null"})`,
					);
				}
				const scope = JSON.stringify([
					filters.windowId ?? null,
					filters.status ?? null,
					filters.reportStatus ?? null,
				]);
				if (filters.cursor) {
					try {
						const cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
						if (
							cursor.scope !== scope ||
							typeof cursor.id !== "string" ||
							typeof cursor.at !== "string" ||
							!Number.isFinite(Date.parse(cursor.at))
						) {
							throw new Error("cursor");
						}
						values.push(cursor.at, cursor.id);
						clauses.push(
							`(created_at, submission_id) < ($${values.length - 1}::timestamptz, $${values.length})`,
						);
					} catch {
						throw new DiningStoreValidationError("投稿分页游标无效。");
					}
				}
				values.push(filters.limit + 1);
				// Keep the timestamp parameter typed even when no status filter is present.
				const result = await input.pool.query(
					`select ${OPS_SUBMISSION_COLUMNS} from dining.submissions submission where $1::timestamptz is not null ${clauses.length > 0 ? `and ${clauses.join(" and ")}` : ""} order by created_at desc, submission_id desc limit $${values.length}`,
					values,
				);
				const rows = result.rows.slice(0, filters.limit);
				const last = rows.at(-1);
				return {
					items: await Promise.all(rows.map((row) => projectOpsSubmission(input.pool, row, at))),
					nextCursor:
						result.rows.length > filters.limit && last
							? Buffer.from(
									JSON.stringify({
										scope,
										at: isoDate(last.created_at),
										id: String(last.submission_id),
									}),
								).toString("base64url")
							: null,
				};
			});
		},
		async getSubmission(id): Promise<DiningOpsSubmissionDetail> {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					// Use a consistent view of revisions while an author is editing.
					const row = await loadOpsSubmissionRow(client, id, true);
					const at = now();
					const submission = await projectOpsSubmission(client, row, at);
					const edits = await client.query(
						"select edit_id, edited_at, edited_by, previous_revision, next_revision from dining.submission_edits where submission_id = $1 order by edited_at desc, edit_id desc",
						[id],
					);
					const history: DiningOpsSubmissionDetail["edits"] = [];
					if (submission.status !== "purged") {
						for (const edit of edits.rows) {
							history.push({
								editId: String(edit.edit_id),
								editedAt: isoDate(edit.edited_at),
								editedBy: nullableString(edit.edited_by),
								previousRevision: Number(edit.previous_revision),
								nextRevision: Number(edit.next_revision),
								previous: await resolveSubmissionSnapshot(
									client,
									row,
									Number(edit.previous_revision),
									at,
								),
								next: await resolveSubmissionSnapshot(client, row, Number(edit.next_revision), at),
							});
						}
					}
					return { submission, edits: history };
				}),
			);
		},
		async getPhoto(id, photoId, ifNoneMatch) {
			return withDiningStoreErrors(async () => {
				const row = await loadOpsSubmissionRow(input.pool, id);
				const at = now();
				if (!submissionContentAvailable(row, at)) {
					throw new DiningStoreNotFoundError("投稿图片不可回放。");
				}
				const result = await input.pool.query(
					"select photo_id, object_key, current, expires_at, cleanup_started_at, cleanup_status from dining.submission_photos where submission_id = $1 and photo_id = $2",
					[id, photoId],
				);
				const photo = result.rows[0];
				if (!(photo && photoAvailable(photo, at))) {
					throw new DiningStoreNotFoundError("投稿图片不可回放。");
				}
				if (!photo.current) {
					const references = await input.pool.query(
						"select 1 from dining.submission_edits where submission_id = $1 and previous_photo_id = $2 and previous_name is not null and expires_at > $3 limit 1",
						[id, photoId, at.toISOString()],
					);
					if (!references.rows[0]) {
						throw new DiningStoreNotFoundError("投稿图片不可回放。");
					}
				}
				// Reached only after admission and state checks: a matching validator
				// skips the body transfer, never the checks.
				const etag = photoETag(String(photo.photo_id));
				if (ifNoneMatchMatches(ifNoneMatch, etag)) {
					return { etag, notModified: true };
				}
				const bytes = await input.assets.get(String(photo.object_key));
				if (!bytes) {
					throw new DiningStoreNotFoundError("投稿图片不存在。");
				}
				return { bytes, etag, notModified: false };
			});
		},
		setVisibility: (actor, id, revision, visible) =>
			mutate(actor, id, revision, visible ? "unhide" : "hide"),
		deleteSubmission: (actor, id, revision) => mutate(actor, id, revision, "delete"),
		restoreSubmission: (actor, id, revision) => mutate(actor, id, revision, "restore"),
		async resolveReports(actor, id, revision, resolution) {
			await mutate(actor, id, revision, resolution === "keep" ? "keep" : "hide", true);
		},
	};
}

export function createUnavailableDiningSubmissionStore(error: unknown): DiningSubmissionStore {
	const unavailable = async (): Promise<never> => {
		throw new DiningStoreUnavailableError("投稿治理存储不可用。", { cause: error });
	};
	return {
		listSubmissions: unavailable,
		getSubmission: unavailable,
		getPhoto: unavailable,
		setVisibility: unavailable,
		deleteSubmission: unavailable,
		restoreSubmission: unavailable,
		resolveReports: unavailable,
	};
}

function photoETag(photoId: string) {
	return `"${photoId}"`;
}

// If-None-Match uses weak comparison: W/"x" matches "x", and "*" matches any.
function ifNoneMatchMatches(header: string | null, etag: string) {
	if (!header) {
		return false;
	}
	return header.split(",").some((candidate) => {
		const trimmed = candidate.trim();
		return trimmed === "*" || trimmed.replace(/^W\//, "") === etag;
	});
}

import type { NoticeCategory } from "campus-contracts/notices";
import type { Pool } from "pg";
import type {
	NoticeDetail,
	NoticeListCounts,
	NoticeState,
	NoticeSummary,
} from "../shared/ops-contract.ts";

const PAGE_SIZE = 30;

export interface NoticeListInput {
	category?: NoticeCategory;
	issueStage?: "classification" | "publication";
	page: number;
	q?: string;
	state?: NoticeState;
}

export interface NoticeStore {
	get(noticeId: number): Promise<NoticeDetail | null>;
	list(input: NoticeListInput): Promise<{
		items: NoticeSummary[];
		page: number;
		totalItems: number;
		totalPages: number;
		counts: NoticeListCounts;
	}>;
	updateCategory(noticeId: number, category: NoticeCategory): Promise<NoticeDetail>;
}

export class NoticeNotFoundError extends Error {
	constructor() {
		super("通知不存在。");
		this.name = "NoticeNotFoundError";
	}
}

export class NoticeStoreUnavailableError extends Error {
	constructor(message = "通知数据库暂不可用。", options?: ErrorOptions) {
		super(message, options);
		this.name = "NoticeStoreUnavailableError";
	}
}

interface NoticeRow extends Record<string, unknown> {
	category: string | null;
	external_url: string | null;
	is_external: boolean;
	is_published: boolean;
	notice_id: string;
	notice_type: number;
	notice_type_name: string;
	organization_id: string | null;
	organization_name: string | null;
	released_at: Date | string;
	title: string;
}

const NOTICE_SELECT = `
	n.notice_id::text, n.notice_type, t.name AS notice_type_name,
	n.organization_id, o.name AS organization_name, n.title, n.released_at,
	n.is_external, n.external_url, n.category, n.is_published,
	COALESCE((SELECT json_agg(json_build_object('stage', f.stage, 'errorType', f.error_type, 'rawError', f.raw_error, 'failedAt', f.failed_at) ORDER BY f.stage)
	FROM notices.processing_failures f WHERE f.notice_id=n.notice_id), '[]'::json) AS processing_failures`;

export function createPgNoticeStore(pool: Pick<Pool, "query" | "connect">): NoticeStore {
	return {
		async get(noticeId) {
			return withDatabaseError(async () => {
				const result = await pool.query<NoticeRow>(
					`SELECT ${NOTICE_SELECT}
					 FROM notices.notices AS n
					 JOIN notices.notice_types AS t ON t.notice_type=n.notice_type
					 LEFT JOIN notices.organizations AS o ON o.organization_id=n.organization_id
					 WHERE n.notice_id=$1`,
					[noticeId],
				);
				return result.rows[0] ? toNotice(result.rows[0]) : null;
			});
		},
		async list(input) {
			return withDatabaseError(async () => {
				const values: unknown[] = [];
				const baseConditions: string[] = [];
				if (input.q) {
					values.push(`%${input.q}%`);
					baseConditions.push(
						`(n.title ILIKE $${values.length} OR n.notice_id::text = $${values.length + 1})`,
					);
					values.push(input.q);
				}
				if (input.category) {
					values.push(input.category);
					baseConditions.push(`n.category = $${values.length}`);
				}
				if (input.issueStage) {
					values.push(input.issueStage);
					baseConditions.push(
						`EXISTS (SELECT 1 FROM notices.processing_failures f WHERE f.notice_id=n.notice_id AND f.stage=$${values.length})`,
					);
				}
				const conditions = [...baseConditions];
				if (input.state === "needs_classification") {
					conditions.push("n.category IS NULL");
				} else if (input.state === "needs_publication") {
					conditions.push("n.category IS NOT NULL AND NOT n.is_published");
				} else if (input.state === "published") {
					conditions.push("n.is_published");
				}
				const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(" AND ")}` : "";
				const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
				const count = await pool.query<{
					all_count: string;
					needs_classification: string;
					needs_publication: string;
					published: string;
				}>(
					`SELECT
						count(*)::text AS all_count,
						count(*) FILTER (WHERE n.category IS NULL)::text AS needs_classification,
						count(*) FILTER (WHERE n.category IS NOT NULL AND NOT n.is_published)::text AS needs_publication,
						count(*) FILTER (WHERE n.is_published)::text AS published
					 FROM notices.notices AS n ${baseWhere}`,
					values,
				);
				const countRow = count.rows[0];
				const counts: NoticeListCounts = {
					all: Number(countRow?.all_count ?? "0"),
					needsClassification: Number(countRow?.needs_classification ?? "0"),
					needsPublication: Number(countRow?.needs_publication ?? "0"),
					published: Number(countRow?.published ?? "0"),
				};
				const totalItems = input.state
					? input.state === "needs_classification"
						? counts.needsClassification
						: input.state === "needs_publication"
							? counts.needsPublication
							: counts.published
					: counts.all;
				const listValues = [...values, PAGE_SIZE, (input.page - 1) * PAGE_SIZE];
				const rows = await pool.query<NoticeRow>(
					`SELECT ${NOTICE_SELECT}
					 FROM notices.notices AS n
					 JOIN notices.notice_types AS t ON t.notice_type=n.notice_type
					 LEFT JOIN notices.organizations AS o ON o.organization_id=n.organization_id
					 ${where}
					 ORDER BY n.released_at DESC, n.notice_id DESC
						LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
					listValues,
				);
				return {
					items: rows.rows.map(toNotice),
					page: input.page,
					totalItems,
					totalPages: Math.ceil(totalItems / PAGE_SIZE),
					counts,
				};
			});
		},
		async updateCategory(noticeId, category) {
			return withDatabaseError(async () => {
				const client = await pool.connect();
				try {
					await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					const updated = await client.query(
						"UPDATE notices.notices SET category=$2 WHERE notice_id=$1 RETURNING notice_id",
						[noticeId, category],
					);
					if (updated.rowCount !== 1) {
						throw new NoticeNotFoundError();
					}
					// A new statement sees a failure committed while UPDATE waited for the row lock.
					await client.query(
						"DELETE FROM notices.processing_failures WHERE notice_id=$1 AND stage='classification'",
						[noticeId],
					);
					await client.query("COMMIT");
				} catch (error) {
					await client.query("ROLLBACK");
					throw error;
				} finally {
					client.release();
				}
				const notice = await this.get(noticeId);
				if (!notice) {
					throw new NoticeNotFoundError();
				}
				return notice;
			});
		},
	};
}

export function createUnavailableNoticeStore(cause: unknown): NoticeStore {
	const fail = () => Promise.reject(new NoticeStoreUnavailableError(undefined, { cause }));
	return { get: fail, list: fail, updateCategory: fail };
}

function toNotice(row: NoticeRow): NoticeSummary {
	return {
		processingFailures: (row.processing_failures ?? []) as NonNullable<
			NoticeSummary["processingFailures"]
		>,
		category: row.category as NoticeCategory | null,
		externalUrl: row.external_url,
		isExternal: row.is_external,
		noticeId: Number(row.notice_id),
		noticeType: { id: row.notice_type, name: row.notice_type_name },
		organization:
			row.organization_id && row.organization_name
				? { id: row.organization_id, name: row.organization_name }
				: null,
		releasedAt: new Date(row.released_at).toISOString(),
		state:
			row.category === null
				? "needs_classification"
				: row.is_published
					? "published"
					: "needs_publication",
		title: row.title,
	};
}

async function withDatabaseError<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof NoticeNotFoundError || error instanceof NoticeStoreUnavailableError) {
			throw error;
		}
		throw new NoticeStoreUnavailableError(undefined, { cause: error });
	}
}

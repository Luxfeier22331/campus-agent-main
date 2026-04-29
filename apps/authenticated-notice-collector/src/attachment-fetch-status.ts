import { createHash } from "node:crypto";
import { Pool } from "pg";

export interface AttachmentFetchStatusLookupInput {
	siteId: string;
	noticeId: string;
	attachmentRefId: string;
	sourceUrl: string;
}

export interface TerminalUnavailableAttachmentFetchStatus {
	fetchStatus: "terminal_unavailable";
	terminalReason: string;
	lastHttpStatus: number | null;
	lastError: string | null;
}

export interface AuthenticatedNoticeAttachmentFetchStatusStore {
	getTerminalUnavailable(
		input: AttachmentFetchStatusLookupInput,
	): Promise<TerminalUnavailableAttachmentFetchStatus | null>;
}

export interface DisposableAttachmentFetchStatusStore
	extends AuthenticatedNoticeAttachmentFetchStatusStore {
	dispose(): Promise<void>;
}

const DEFAULT_TABLE_NAME = "ingestion_projection.authenticated_notice_attachment_fetch_status";

export function buildAttachmentSourceUrlHash(sourceUrl: string): string {
	return createHash("sha256").update(sourceUrl.trim()).digest("hex");
}

export function createPostgresAttachmentFetchStatusStore(input: {
	databaseUrl: string;
	tableName?: string;
}): DisposableAttachmentFetchStatusStore {
	const tableName = toQualifiedTableSql(input.tableName ?? DEFAULT_TABLE_NAME);
	const pool = new Pool({ connectionString: input.databaseUrl });
	return {
		async getTerminalUnavailable(lookup) {
			const result = await pool.query(
				`
				select record
				from ${tableName}
				where site_id = $1
					and notice_id = $2
					and attachment_ref_id = $3
					and source_url_hash = $4
					and fetch_status = 'terminal_unavailable'
				limit 1
				`,
				[
					lookup.siteId,
					lookup.noticeId,
					lookup.attachmentRefId,
					buildAttachmentSourceUrlHash(lookup.sourceUrl),
				],
			);
			const record = result.rows[0]?.record;
			if (!record || typeof record !== "object") {
				return null;
			}
			const terminalReason = normalizeOptionalText(record.terminal_reason);
			if (!terminalReason) {
				return null;
			}
			return {
				fetchStatus: "terminal_unavailable",
				terminalReason,
				lastHttpStatus: normalizeOptionalNumber(record.last_http_status),
				lastError: normalizeOptionalText(record.last_error),
			};
		},
		async dispose() {
			await pool.end();
		},
	};
}

function toQualifiedTableSql(tableName: string): string {
	const parts = tableName.split(".");
	if (parts.length === 0 || parts.length > 2) {
		throw new Error(`invalid attachment fetch-status table name: ${tableName}`);
	}
	return parts.map(quoteIdentifier).join(".");
}

function quoteIdentifier(identifier: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new Error(`invalid attachment fetch-status table identifier: ${identifier}`);
	}
	return `"${identifier}"`;
}

function normalizeOptionalText(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const text = String(value).trim();
	return text || null;
}

function normalizeOptionalNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

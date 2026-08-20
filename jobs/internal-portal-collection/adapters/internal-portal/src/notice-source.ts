import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import type { NoticeDetailInfo, NoticeItem } from "./types.js";

export interface InternalPortalNoticeSourceStore {
	get(noticeId: number): Promise<InternalPortalNoticeSource | null>;
	has(noticeId: number): Promise<boolean>;
	put(source: InternalPortalNoticeSource): Promise<"reused" | "written">;
}

export function buildInternalPortalNoticeSource(input: {
	detailInfo: NoticeDetailInfo;
	listItem: NoticeItem;
	noticeId: number;
	noticeType: number;
}): InternalPortalNoticeSource {
	if (input.detailInfo.notice_id !== input.noticeId) {
		throw new Error(
			`notice ${input.noticeId} detail returned notice_id ${String(input.detailInfo.notice_id)}`,
		);
	}
	const externalUrl = normalizeExternalUrl(
		input.listItem.notice_link,
		input.detailInfo.notice_link,
	);
	const common = {
		attachments: normalizeAttachments(input.detailInfo),
		notice_content_html: normalizeText(input.detailInfo.notice_content),
		notice_id: input.noticeId,
		notice_release_time: normalizeText(input.detailInfo.notice_release_time),
		notice_title: requireText(input.detailInfo.notice_title, "notice_title"),
		notice_type: input.noticeType,
		organization_id: normalizeText(
			input.listItem.organization_id ?? input.detailInfo.organization_id,
		),
		schema_version: "internal_portal_notice_source.v2" as const,
	};
	const source: InternalPortalNoticeSource = externalUrl
		? { ...common, external_url: externalUrl, is_external: true }
		: { ...common, external_url: null, is_external: false };
	const validation = validateInternalPortalNoticeSource(source);
	if (!validation.ok) {
		throw new Error(`internal portal notice source is invalid: ${validation.errors.join("; ")}`);
	}
	return source;
}

export function createInternalPortalNoticeSourceStore(input: {
	objectStore: InternalPortalCollectionObjectStore;
}): InternalPortalNoticeSourceStore {
	return {
		async get(noticeId) {
			const key = internalPortalNoticeSourceObjectKey(noticeId);
			const existingBytes = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key,
			});
			if (!existingBytes) {
				return null;
			}
			const existing = parseStoredNoticeSource(existingBytes);
			if (existing.notice_id !== noticeId) {
				throw new Error(`internal portal notice source identity does not match object key: ${key}`);
			}
			return existing;
		},
		async has(noticeId) {
			return (await this.get(noticeId)) !== null;
		},
		async put(source) {
			const key = internalPortalNoticeSourceObjectKey(source.notice_id);
			await input.objectStore.createOrVerifyObject({
				body: Buffer.from(`${JSON.stringify(source, null, 2)}\n`, "utf-8"),
				bucket: input.objectStore.sourceBucket,
				contentType: "application/json",
				key,
			});
			return "written";
		},
	};
}

export function internalPortalNoticeSourceObjectKey(noticeId: number): string {
	return `internal_portal/notices/${noticeId}.json`;
}

function normalizeAttachments(detail: NoticeDetailInfo): InternalPortalNoticeSource["attachments"] {
	return (detail.notice_annext ?? []).map((annex) => ({
		notice_annex_id: normalizeText(annex.notice_annex_id),
		notice_annex_name: normalizeText(annex.notice_annex_name),
		notice_annex_path: normalizeText(annex.notice_annex_path),
		suffix: normalizeText(annex.suffix),
		type: normalizeText(annex.type),
	}));
}

function parseStoredNoticeSource(bytes: Uint8Array): InternalPortalNoticeSource {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(bytes).toString("utf-8"));
	} catch (error) {
		throw new Error("internal portal notice source is not valid JSON", { cause: error });
	}
	const validation = validateInternalPortalNoticeSource(value);
	if (!validation.ok) {
		throw new Error(`internal portal notice source is invalid: ${validation.errors.join("; ")}`);
	}
	return value as InternalPortalNoticeSource;
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized || null;
}

function normalizeExternalUrl(
	listValue: string | null | undefined,
	detailValue: string | null | undefined,
): string | null {
	const value = normalizeText(listValue) ?? normalizeText(detailValue);
	if (!value) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch (error) {
		throw new Error("notice external URL must be an absolute HTTP or HTTPS URL", { cause: error });
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username ||
		parsed.password
	) {
		throw new Error("notice external URL must be an absolute HTTP or HTTPS URL");
	}
	return value;
}

function requireText(value: string | null | undefined, field: string): string {
	const normalized = normalizeText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

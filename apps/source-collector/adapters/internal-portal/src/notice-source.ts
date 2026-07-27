import { isDeepStrictEqual } from "node:util";
import { encodeObjectKeySegment } from "ingest-core";
import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import type { NoticeDetailInfo } from "./types.js";

export interface InternalPortalNoticeSourceStore {
	put(source: InternalPortalNoticeSource): Promise<"reused" | "written">;
}

export function buildInternalPortalNoticeSource(input: {
	detailInfo: NoticeDetailInfo;
	noticeId: number;
	siteId: string;
}): InternalPortalNoticeSource {
	if (input.detailInfo.notice_id !== input.noticeId) {
		throw new Error(
			`notice ${input.noticeId} detail returned notice_id ${String(input.detailInfo.notice_id)}`,
		);
	}
	const source: InternalPortalNoticeSource = {
		attachments: normalizeAttachments(input.detailInfo),
		notice_content: normalizeText(input.detailInfo.notice_content),
		notice_id: input.noticeId,
		notice_link: normalizeText(input.detailInfo.notice_link),
		notice_release_time: normalizeText(input.detailInfo.notice_release_time),
		notice_title: requireText(input.detailInfo.notice_title, "notice_title"),
		notice_type: "5",
		notice_type_name: normalizeText(input.detailInfo.notice_type_name),
		organization_id: normalizeText(input.detailInfo.organization_id),
		organization_name: normalizeText(input.detailInfo.organization_name),
		schema_version: "internal_portal_notice_source.v1",
		site_id: input.siteId,
	};
	const validation = validateInternalPortalNoticeSource(source);
	if (!validation.ok) {
		throw new Error(`internal portal notice source is invalid: ${validation.errors.join("; ")}`);
	}
	return source;
}

export function createInternalPortalNoticeSourceStore(input: {
	objectStore: SourceCollectorObjectStore;
}): InternalPortalNoticeSourceStore {
	return {
		async put(source) {
			const key = internalPortalNoticeSourceObjectKey(source.site_id, source.notice_id);
			const existingBytes = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key,
			});
			if (existingBytes) {
				const existing = parseStoredNoticeSource(existingBytes);
				if (existing.site_id !== source.site_id || existing.notice_id !== source.notice_id) {
					throw new Error(
						`internal portal notice source identity does not match object key: ${key}`,
					);
				}
				if (!isDeepStrictEqual(existing, source)) {
					throw new Error(
						`internal portal notice ${source.notice_id} source differs from the stored object`,
					);
				}
				return "reused";
			}
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

export function internalPortalNoticeSourceObjectKey(siteId: string, noticeId: number): string {
	return `internal_portal/${encodeObjectKeySegment(siteId)}/notices/${noticeId}.json`;
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

function requireText(value: string | null | undefined, field: string): string {
	const normalized = normalizeText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

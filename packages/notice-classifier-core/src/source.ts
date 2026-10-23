export const NOTICE_SOURCE_PREFIX = "internal_portal/notices/";
export const NOTICE_SOURCE_SCHEMA_VERSION = "internal_portal_notice_source.v2";

const NOTICE_SOURCE_KEY_PATTERN = /^internal_portal\/notices\/([1-9][0-9]*)\.json$/u;

export interface NoticeClassificationSource {
	notice_id: number;
	notice_title: string;
	schema_version: typeof NOTICE_SOURCE_SCHEMA_VERSION;
}

export function noticeSourceKey(noticeId: number): string {
	if (!Number.isSafeInteger(noticeId) || noticeId < 1) {
		throw new Error(`invalid notice id: ${String(noticeId)}`);
	}
	return `${NOTICE_SOURCE_PREFIX}${noticeId}.json`;
}

export function noticeSourceIdFromKey(key: string): number | null {
	const match = NOTICE_SOURCE_KEY_PATTERN.exec(key);
	if (!match) {
		return null;
	}
	const noticeId = Number(match[1]);
	if (!Number.isSafeInteger(noticeId)) {
		throw new Error(`notice object key has an unsafe integer id: ${key}`);
	}
	return noticeId;
}

export function validateNoticeIds(noticeIds: readonly number[]): number[] {
	const seen = new Set<number>();
	for (const noticeId of noticeIds) {
		if (!Number.isSafeInteger(noticeId) || noticeId < 1) {
			throw new Error(`invalid notice id: ${String(noticeId)}`);
		}
		if (seen.has(noticeId)) {
			throw new Error(`duplicate notice id: ${noticeId}`);
		}
		seen.add(noticeId);
	}
	return [...seen];
}

export function parseNoticeClassificationSource(
	value: unknown,
	key: string,
): NoticeClassificationSource {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${key} is not a notice source object`);
	}
	const record = value as Record<string, unknown>;
	if (record.schema_version !== NOTICE_SOURCE_SCHEMA_VERSION) {
		throw new Error(`${key} has unsupported schema_version`);
	}
	const noticeId = record.notice_id;
	if (typeof noticeId !== "number" || !Number.isSafeInteger(noticeId) || noticeId < 1) {
		throw new Error(`${key} has an invalid notice_id`);
	}
	if (typeof record.notice_title !== "string" || !record.notice_title.trim()) {
		throw new Error(`${key} has an invalid notice_title`);
	}
	return {
		notice_id: noticeId,
		notice_title: record.notice_title,
		schema_version: NOTICE_SOURCE_SCHEMA_VERSION,
	};
}

export function parseNoticeClassificationSourceJson(
	body: string | Uint8Array,
	key: string,
): NoticeClassificationSource {
	let value: unknown;
	try {
		const text =
			typeof body === "string" ? body : new TextDecoder("utf-8", { fatal: true }).decode(body);
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`${key} is not valid JSON`, { cause: error });
	}
	return parseNoticeClassificationSource(value, key);
}

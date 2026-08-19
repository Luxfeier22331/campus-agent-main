import {
	NoticeClassificationArtifactSchema,
	type NoticeClassificationArtifact,
} from "campus-contracts/notices";

import type { NoticeCategory } from "./classifier.ts";
import type { NoticeClassifierObjectStore } from "./object-store.ts";

export const NOTICE_CLASSIFICATION_PREFIX = "notices/classifications/";

export function noticeClassificationKey(noticeId: number): string {
	if (!Number.isSafeInteger(noticeId) || noticeId < 1) {
		throw new Error(`invalid notice id: ${String(noticeId)}`);
	}
	return `${NOTICE_CLASSIFICATION_PREFIX}${noticeId}.json`;
}

export async function readNoticeClassificationArtifact(
	objectStore: Pick<NoticeClassifierObjectStore, "getDerived">,
	noticeId: number,
): Promise<NoticeClassificationArtifact | null> {
	const body = await objectStore.getDerived(noticeClassificationKey(noticeId));
	if (!body) return null;
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
	} catch {
		return null;
	}
	const parsed = NoticeClassificationArtifactSchema.safeParse(value);
	if (!parsed.success || parsed.data.notice_id !== noticeId) return null;
	return parsed.data;
}

export async function writeNoticeClassificationArtifact(
	objectStore: Pick<NoticeClassifierObjectStore, "putDerived">,
	input: { category: NoticeCategory; noticeId: number },
): Promise<NoticeClassificationArtifact> {
	const artifact = NoticeClassificationArtifactSchema.parse({
		category: input.category,
		notice_id: input.noticeId,
		schema_version: "notice_classification.v1",
	});
	const body = new TextEncoder().encode(
		`${JSON.stringify({
			category: artifact.category,
			notice_id: artifact.notice_id,
			schema_version: artifact.schema_version,
		})}\n`,
	);
	await objectStore.putDerived(noticeClassificationKey(input.noticeId), body);
	return artifact;
}

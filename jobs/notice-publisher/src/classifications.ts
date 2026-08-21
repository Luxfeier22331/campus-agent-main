import { isNoticeCategory, type NoticeCategory } from "@campus-agent/notices";
import { NoticeClassificationArtifactSchema } from "campus-contracts/notices";

import type { PublisherObjectStore } from "./store.ts";

const NOTICE_SOURCE_PREFIX = "internal_portal/notices/";
const NOTICE_SOURCE_PATTERN = /^internal_portal\/notices\/([1-9][0-9]*)\.json$/u;
const CLASSIFICATION_PREFIX = "notices/classifications/";
const CLASSIFICATION_PATTERN = /^notices\/classifications\/([1-9][0-9]*)\.json$/u;

export interface Classification {
	category: NoticeCategory;
	noticeId: number;
}

export function parseClassifications(input: string): Classification[] {
	const classifications: Classification[] = [];
	const seen = new Set<number>();
	for (const [index, line] of input.split(/\r?\n/u).entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (error) {
			throw new Error(`classification line ${index + 1} is invalid JSON`, { cause: error });
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`classification line ${index + 1} is invalid`);
		}
		const item = value as Record<string, unknown>;
		if (
			!Number.isSafeInteger(item.notice_id) ||
			Number(item.notice_id) <= 0 ||
			!isNoticeCategory(item.category) ||
			Object.keys(item).sort().join(",") !== "category,notice_id"
		) {
			throw new Error(`classification line ${index + 1} is invalid`);
		}
		const noticeId = Number(item.notice_id);
		if (seen.has(noticeId)) {
			throw new Error(`duplicate classification for notice ${noticeId}`);
		}
		seen.add(noticeId);
		classifications.push({ category: item.category, noticeId });
	}
	return classifications;
}

export async function resolvePublishClassifications(input: {
	classifications?: readonly Classification[];
	noticeIds?: readonly number[];
	objectStore: PublisherObjectStore;
}): Promise<Classification[]> {
	const selectedIds = input.noticeIds ? validateNoticeIds(input.noticeIds) : undefined;
	if (input.classifications) {
		const byId = classificationMap(input.classifications);
		if (selectedIds) return classificationsForIds(byId, selectedIds);
		const sourceIds = await listNoticeSourceIds(input.objectStore);
		assertSameInventory(sourceIds, [...byId.keys()]);
		return classificationsForIds(byId, sourceIds);
	}

	const sourceIds = selectedIds ?? (await listNoticeSourceIds(input.objectStore));
	if (!selectedIds) {
		assertSameInventory(sourceIds, await listClassificationIds(input.objectStore));
	}
	const classifications: Classification[] = [];
	for (const noticeId of sourceIds) {
		classifications.push(await loadClassificationArtifact(input.objectStore, noticeId));
	}
	return classifications;
}

async function listNoticeSourceIds(store: PublisherObjectStore): Promise<number[]> {
	const ids = new Set<number>();
	for (const key of await store.listSource(NOTICE_SOURCE_PREFIX)) {
		const match = NOTICE_SOURCE_PATTERN.exec(key);
		if (match) {
			const noticeId = Number(match[1]);
			if (ids.has(noticeId)) {
				throw new Error(`duplicate notice source object for notice ${noticeId}`);
			}
			ids.add(noticeId);
			continue;
		}
		const relative = key.slice(NOTICE_SOURCE_PREFIX.length);
		if (relative !== "_state.json" && !relative.includes("/")) {
			throw new Error(`invalid notice source object key: ${key}`);
		}
	}
	if (ids.size === 0) throw new Error("no notice source objects were found");
	return [...ids].sort((left, right) => left - right);
}

async function listClassificationIds(store: PublisherObjectStore): Promise<number[]> {
	const ids = new Set<number>();
	for (const key of await store.listDerived(CLASSIFICATION_PREFIX)) {
		const match = CLASSIFICATION_PATTERN.exec(key);
		if (!match) throw new Error(`invalid notice classification object key: ${key}`);
		const noticeId = Number(match[1]);
		if (ids.has(noticeId)) {
			throw new Error(`duplicate classification object for notice ${noticeId}`);
		}
		ids.add(noticeId);
	}
	return [...ids].sort((left, right) => left - right);
}

async function loadClassificationArtifact(
	store: PublisherObjectStore,
	noticeId: number,
): Promise<Classification> {
	const key = `${CLASSIFICATION_PREFIX}${noticeId}.json`;
	const stored = await store.getDerived(key);
	if (!stored) throw new Error(`notice ${noticeId} has no classification artifact`);
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.body));
	} catch (error) {
		throw new Error(`${key} is not valid UTF-8 JSON`, { cause: error });
	}
	const parsed = NoticeClassificationArtifactSchema.safeParse(value);
	if (!parsed.success) throw new Error(`${key} violates notice_classification.v1`);
	if (parsed.data.notice_id !== noticeId) throw new Error(`${key} has mismatched notice_id`);
	return { category: parsed.data.category, noticeId };
}

function validateNoticeIds(ids: readonly number[]): number[] {
	const seen = new Set<number>();
	for (const id of ids) {
		if (!Number.isSafeInteger(id) || id <= 0) {
			throw new Error(`invalid notice id: ${String(id)}`);
		}
		if (seen.has(id)) throw new Error(`duplicate notice id: ${id}`);
		seen.add(id);
	}
	if (seen.size === 0) throw new Error("no notice ids selected");
	return [...seen].sort((left, right) => left - right);
}

function classificationMap(
	classifications: readonly Classification[],
): Map<number, Classification> {
	const byId = new Map<number, Classification>();
	for (const classification of classifications) {
		if (
			!Number.isSafeInteger(classification.noticeId) ||
			classification.noticeId <= 0 ||
			!isNoticeCategory(classification.category)
		) {
			throw new Error("invalid classification");
		}
		if (byId.has(classification.noticeId)) {
			throw new Error(`duplicate classification for notice ${classification.noticeId}`);
		}
		byId.set(classification.noticeId, classification);
	}
	return byId;
}

function classificationsForIds(
	byId: ReadonlyMap<number, Classification>,
	ids: readonly number[],
): Classification[] {
	if (ids.length === 0) throw new Error("no classifications selected");
	return [...ids].sort((left, right) => left - right).map((noticeId) => {
		const classification = byId.get(noticeId);
		if (!classification) throw new Error(`notice ${noticeId} has no classification`);
		return classification;
	});
}

function assertSameInventory(
	sourceIds: readonly number[],
	classificationIds: readonly number[],
): void {
	const source = new Set(sourceIds);
	const classifications = new Set(classificationIds);
	const missing = sourceIds.filter((id) => !classifications.has(id));
	const extra = classificationIds.filter((id) => !source.has(id));
	if (missing.length || extra.length) {
		throw new Error(
			`notice classification inventory mismatch: missing=[${missing.join(",")}], extra=[${extra.join(",")}]`,
		);
	}
}

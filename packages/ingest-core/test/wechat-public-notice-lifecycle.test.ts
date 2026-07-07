import { describe, expect, it } from "vitest";
import {
	applyWeChatPublicNoticeProjectionRebuild,
	applyWeChatPublicNoticeReadModelMaterialization,
	type InternalNoticeReadModelEntry,
	type NoticeConsumptionProjectionEntry,
} from "../src/index.ts";

describe("wechat public notice lifecycle", () => {
	it("applies projection rows by selected WeChat notice ids", () => {
		const projectionStore = new InMemoryNoticeConsumptionProjectionStore([
			projectionEntry("woa_article_refresh", "stale-unit"),
			projectionEntry("woa_article_unrelated", "unrelated-unit"),
		]);

		const rows = applyWeChatPublicNoticeProjectionRebuild({
			projectionEntries: [
				projectionEntry("woa_article_refresh", "notice_unit:wechat:woa_article_refresh:fresh"),
			],
			projectionStore,
		});

		expect(rows.map((row) => row.unit_id)).toEqual([
			"notice_unit:wechat:woa_article_refresh:fresh",
		]);
		expect(
			projectionStore
				.listByScope("campus_notices", "wechat_public_notice")
				.map((row) => row.unit_id),
		).toEqual(["notice_unit:wechat:woa_article_refresh:fresh", "unrelated-unit"]);
	});

	it("materializes read-model rows by selected WeChat notice ids", () => {
		const readModelStore = new InMemoryReadModelStore([
			readModelEntry("woa_article_refresh", "stale-unit", {
				sourceUrl: "https://mp.weixin.qq.com/s/old",
			}),
			readModelEntry("woa_article_unrelated", "unrelated-unit", {
				sourceUrl: "https://mp.weixin.qq.com/s/unrelated",
			}),
		]);

		const rows = applyWeChatPublicNoticeReadModelMaterialization({
			readModelRows: [
				readModelEntry("woa_article_refresh", "notice_unit:wechat:woa_article_refresh", {
					sourceUrl: "https://mp.weixin.qq.com/s/new",
				}),
			],
			readModelStore,
		});

		expect(rows.map((row) => row.source_url)).toEqual(["https://mp.weixin.qq.com/s/new"]);
		expect(
			readModelStore
				.listByScope("campus_notices", "wechat_public_notice")
				.map((row) => row.source_notice_id)
				.sort(),
		).toEqual(["woa_article_refresh", "woa_article_unrelated"]);
	});

	it("does not rewrite read-model store when there are no selected notices", () => {
		const readModelStore = new InMemoryReadModelStore([
			readModelEntry("woa_article_unrelated", "unrelated-unit"),
		]);

		const rows = applyWeChatPublicNoticeReadModelMaterialization({
			readModelRows: [],
			readModelStore,
		});

		expect(rows).toEqual([]);
		expect(readModelStore.listByScope("campus_notices", "wechat_public_notice")).toHaveLength(1);
	});
});

function projectionEntry(noticeId: string, unitId: string): NoticeConsumptionProjectionEntry {
	return {
		answerability: "body_only_answerable",
		completeness_status: "complete",
		consumption_status: "retained_for_notice_query",
		default_agent: "notice",
		primary_role: "notice_window",
		role_metadata: {
			notice_title: "微信公众号通知",
			source_url: `https://mp.weixin.qq.com/s/${noticeId}`,
		},
		semantic_owner: "notice_body",
		source_attachment_ref_ids: [],
		source_collection: "wechat_public_notice",
		source_corpus: "campus_notices",
		source_document_id: `wechat_notice:muc:${noticeId}`,
		source_family: "wechat_public_notice",
		source_notice_document_id: `wechat_notice:muc:${noticeId}`,
		source_notice_id: noticeId,
		source_notice_release_time: "2026-04-21T08:00:00+08:00",
		target_surface: "notice_level_query",
		temporal_policy: "announcement_window",
		unit_id: unitId,
		updated_at: "2026-04-21T08:00:00+08:00",
	};
}

function readModelEntry(
	noticeId: string,
	unitId: string,
	input: { sourceUrl?: string } = {},
): InternalNoticeReadModelEntry {
	const sourceUrl = input.sourceUrl ?? `https://mp.weixin.qq.com/s/${noticeId}`;
	return {
		attachment_refs: [],
		body_excerpt: "正文摘要",
		canonical_document_id: `wechat_notice:muc:${noticeId}`,
		canonical_markdown_object_key: "",
		canonical_url: sourceUrl,
		consumption_status: "retained_for_notice_query",
		effective_at_ts: "",
		entitlement_groups: [],
		expires_at_ts: "",
		policy_projection_version: "public-notice-projection-v1",
		primary_role: "notice_window",
		projection_updated_at: "2026-04-21T08:00:00+08:00",
		provenance_refs: [unitId],
		published_at: "2026-04-21T08:00:00+08:00",
		published_at_ts: "2026-04-21T08:00:00+08:00",
		queryable: true,
		search_text: "微信公众号通知\n正文摘要",
		source_collection: "wechat_public_notice",
		source_corpus: "campus_notices",
		source_family: "wechat_public_notice",
		source_notice_id: noticeId,
		source_url: sourceUrl,
		target_surface: "notice_level_query",
		title: "微信公众号通知",
		unit_id: unitId,
		updated_at: "2026-04-21T08:00:00+08:00",
		visibility_level: "public",
	};
}

class InMemoryNoticeConsumptionProjectionStore {
	readonly records = new Map<string, NoticeConsumptionProjectionEntry>();

	constructor(records: NoticeConsumptionProjectionEntry[] = []) {
		this.upsertMany(records);
	}

	upsertMany(records: NoticeConsumptionProjectionEntry[]): void {
		for (const record of records) {
			this.records.set(
				`${record.source_corpus}/${record.source_collection}/${record.unit_id}`,
				record,
			);
		}
	}

	replaceNotices(
		sourceCorpus: string,
		sourceCollection: string,
		noticeIds: readonly string[],
		records: readonly NoticeConsumptionProjectionEntry[],
	): void {
		const selected = new Set(noticeIds);
		for (const [key, record] of [...this.records.entries()]) {
			if (
				record.source_corpus === sourceCorpus &&
				record.source_collection === sourceCollection &&
				selected.has(record.source_notice_id)
			) {
				this.records.delete(key);
			}
		}
		this.upsertMany([...records]);
	}

	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input: { noticeIds?: readonly string[] } = {},
	): NoticeConsumptionProjectionEntry[] {
		const selected = new Set(input.noticeIds ?? []);
		return [...this.records.values()]
			.filter(
				(record) =>
					record.source_corpus === sourceCorpus &&
					record.source_collection === sourceCollection &&
					(selected.size === 0 || selected.has(record.source_notice_id)),
			)
			.sort((left, right) =>
				`${left.source_notice_id}/${left.unit_id}`.localeCompare(
					`${right.source_notice_id}/${right.unit_id}`,
				),
			);
	}
}

class InMemoryReadModelStore {
	readonly records = new Map<string, InternalNoticeReadModelEntry>();

	constructor(records: InternalNoticeReadModelEntry[] = []) {
		this.upsertMany(records);
	}

	upsertMany(records: InternalNoticeReadModelEntry[]): void {
		for (const record of records) {
			this.records.set(
				`${record.source_corpus}/${record.source_collection}/${record.unit_id}`,
				record,
			);
		}
	}

	replaceNotices(
		sourceCorpus: string,
		sourceCollection: string,
		noticeIds: readonly string[],
		records: readonly InternalNoticeReadModelEntry[],
	): void {
		const selected = new Set(noticeIds);
		for (const [key, record] of [...this.records.entries()]) {
			if (
				record.source_corpus === sourceCorpus &&
				record.source_collection === sourceCollection &&
				selected.has(record.source_notice_id)
			) {
				this.records.delete(key);
			}
		}
		this.upsertMany([...records]);
	}

	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input: { noticeIds?: readonly string[] } = {},
	): InternalNoticeReadModelEntry[] {
		const selected = new Set(input.noticeIds ?? []);
		return [...this.records.values()]
			.filter(
				(record) =>
					record.source_corpus === sourceCorpus &&
					record.source_collection === sourceCollection &&
					(selected.size === 0 || selected.has(record.source_notice_id)),
			)
			.sort((left, right) =>
				`${left.source_notice_id}/${left.unit_id}`.localeCompare(
					`${right.source_notice_id}/${right.unit_id}`,
				),
			);
	}
}

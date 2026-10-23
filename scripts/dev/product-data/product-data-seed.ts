import { createHash } from "node:crypto";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/bootstrap";
import {
	buildDiningMapResponse,
	diningMapBundleFingerprint,
	renderDiningMapAssets,
} from "@campus-agent/dining/publisher";
import { NOTICE_CATEGORIES } from "@campus-agent/notices";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import { canonicalJsonBytes } from "../../../jobs/campus-docs-index-publisher/src/indexing/content-digest.ts";
import { normalizeSourceManifest } from "../../../packages/contracts/src/campus-docs/node/index.ts";
import { createDocsSourceSiteFixture } from "../../../packages/contracts/test/campus-docs/index.ts";
import { PRODUCT_DATA_TABLES, type ProductDataRows } from "./product-data-tables.ts";

export function createProductSeed(now: Date) {
	const rows = Object.fromEntries(
		Object.keys(PRODUCT_DATA_TABLES).map((table) => [table, []]),
	) as unknown as ProductDataRows;
	const timestamp = now.toISOString();
	const date = timestamp.slice(0, 10);
	const actor = "system:local-seed";
	const docs = createDocsSourceSiteFixture();
	const selectedDocs = new Set(["doc_site_attendance", "doc_undergraduate_1"]);
	const source = normalizeSourceManifest({
		...docs.source,
		topics: docs.source.topics.filter((topic) =>
			docs.source.documents.some(
				(document) => selectedDocs.has(document.docId) && document.topicId === topic.topicId,
			),
		),
		documents: docs.source.documents.filter((document) => selectedDocs.has(document.docId)),
		versions: docs.source.versions.filter((version) => selectedDocs.has(version.docId)),
	});
	const keys = new Set(
		source.versions.flatMap((version) => [
			version.reader.key,
			...version.supplements.flatMap((supplement) => [
				supplement.object.key,
				...supplement.assets.map((asset) => asset.object.key),
			]),
		]),
	);
	const objects = new Map([...docs.objects].filter(([key]) => keys.has(key)));
	objects.set("campus-docs/source.json", {
		body: canonicalJsonBytes(source),
		contentType: "application/json",
	});
	rows["notices.categories"] = NOTICE_CATEGORIES.map((category) => ({ category }));
	rows["notices.notice_types"] = [{ notice_type: 1, name: "校园通知" }];
	rows["notices.organizations"] = [
		{ organization_id: "seed-logistics", name: "后勤服务中心（本地示例）" },
		{ organization_id: "seed-academic", name: "教务处（本地示例）" },
	];
	const image = docs.objects.get("fixtures/docs/course-map.png");
	if (!image) {
		throw new Error("Seed image is missing");
	}
	const imageSha = createHash("sha256").update(image.body).digest("hex");
	objects.set(`notices/assets/sha256/${imageSha}`, image);
	const content = [
		[
			"食堂夜宵服务安排（本地示例）",
			"丰台校区学生食堂开设夜宵服务，供应时间为每日 20:00 至 22:00，地点在学生食堂一层。夜宵提供热面、粥和小吃；具体价格请查看食堂窗口菜单。",
			"<p>丰台校区学生食堂开设夜宵服务。</p><table><tr><th>服务</th><th>时间</th></tr><tr><td>夜宵</td><td>20:00—22:00</td></tr></table>",
		],
		[
			"校车乘车安排（本地示例）",
			"本地示例校车在海淀校区与丰台校区之间运行。学生凭校园卡乘车，请提前十分钟到校门口候车。固定班次为 08:00，接驳班次每 20 分钟一班，详见交通页面。",
			"<p>学生凭校园卡乘车，请提前十分钟候车。</p>",
		],
		[
			"课程修读说明（本地示例）",
			"学生应按时参加教学活动，课程修读要求请参阅文档中的培养方案和学生管理规定。附件仅用于展示元数据，本地示例不提供门户附件下载。",
			`<p>课程修读说明。</p><img src="/api/notices/900003/images/0" alt="课程地图示例" />`,
		],
	];
	rows["notices.notices"] = content.map(([title, text, html], index) => ({
		notice_id: 900001 + index,
		notice_type: 1,
		organization_id: index === 2 ? "seed-academic" : "seed-logistics",
		title,
		released_at: timestamp,
		is_external: false,
		external_url: null,
		content_html: html,
		content_text: text,
		category: NOTICE_CATEGORIES[index % NOTICE_CATEGORIES.length],
		is_published: true,
	}));
	rows["notices.notices"].push(
		{
			...rows["notices.notices"][0],
			notice_id: 900004,
			title: "待发布通知（本地示例）",
			is_published: false,
		},
		{
			...rows["notices.notices"][0],
			notice_id: 900005,
			title: "学校网站（外部链接示例）",
			is_external: true,
			external_url: "https://www.muc.edu.cn/",
			content_html: null,
			content_text: null,
		},
	);
	rows["notices.notice_assets"] = [
		{
			notice_id: 900003,
			asset_kind: "image",
			ordinal: 0,
			original_name: "course-map.png",
			content_type: "image/png",
			byte_size: image.body.byteLength,
			content_sha256: imageSha,
			portal_annex_id: null,
		},
		{
			notice_id: 900003,
			asset_kind: "attachment",
			ordinal: 0,
			original_name: "课程修读说明.pdf",
			content_type: "application/pdf",
			byte_size: 1024,
			content_sha256: "0".repeat(64),
			portal_annex_id: "local-seed-attachment",
		},
	];
	const sourceObjects = new Map<string, { body: Uint8Array; contentType: string }>();
	sourceObjects.set("internal_portal/meta.json", {
		body: Buffer.from(
			JSON.stringify({
				schema_version: "internal_portal_meta.v1",
				notice_types: { "1": "校园通知" },
				organizations: Object.fromEntries(
					rows["notices.organizations"].map((row) => [row.organization_id, row.name]),
				),
				updated_at: timestamp,
			}),
		),
		contentType: "application/json",
	});
	for (const row of rows["notices.notices"]) {
		const source: InternalPortalNoticeSource = {
			schema_version: "internal_portal_notice_source.v2",
			notice_id: Number(row.notice_id),
			notice_type: Number(row.notice_type),
			organization_id: String(row.organization_id),
			notice_title: String(row.title),
			notice_release_time: timestamp,
			notice_content_html: row.content_html as string | null,
			...(row.is_external
				? { is_external: true, external_url: String(row.external_url) }
				: { is_external: false, external_url: null }),
			attachments: [],
			resources:
				row.notice_id === 900003
					? [
							{
								kind: "images",
								ordinal: 0,
								object_key: `internal_portal/assets/sha256/${imageSha}`,
								content_type: image.contentType,
								byte_size: image.body.byteLength,
								sha256: imageSha,
							},
						]
					: [],
		};
		const ref = noticeSourceRef(source);
		row.source_ref = ref;
		row.published_source_ref = row.is_published ? ref : null;
		sourceObjects.set(ref, {
			body: Buffer.from(JSON.stringify(source)),
			contentType: "application/json",
		});
	}
	sourceObjects.set(`internal_portal/assets/sha256/${imageSha}`, image);
	rows["campus_groups.sections"] = [{ id: "seed-study", name: "学习与交流", position: 0 }];
	rows["campus_groups.groups"] = [
		{
			id: "seed-study-group",
			join_url: null,
			name: "学习互助（本地示例）",
			position: 0,
			qq_group_number: "123456789",
			section_id: "seed-study",
			summary: "课程交流与学习互助",
			tags: ["学习", "交流"],
		},
		{
			id: "seed-club",
			join_url: "https://discord.gg/local-example",
			name: "社团活动（本地示例）",
			position: 1,
			qq_group_number: null,
			section_id: "seed-study",
			summary: "社团活动信息",
			tags: ["社团"],
		},
	];
	rows["transport.routes"] = [
		{
			route_id: "seed-commute",
			origin: "海淀校区",
			destination: "丰台校区",
			service_kind: "commute",
			default_boarding_point: "校门口",
			display_order: 0,
			created_at: timestamp,
			updated_at: timestamp,
			updated_by: actor,
			drop_off_point: "学生食堂附近",
			boarding_guide: "请提前十分钟候车",
		},
	];
	rows["transport.schedule_periods"] = ["operating", "suspended"].map((status, i) => ({
		schedule_id: `seed-schedule-${i}`,
		route_id: "seed-commute",
		valid_from: date,
		valid_to: null,
		weekdays: i ? [6, 7] : [1, 2, 3, 4, 5],
		status,
		boarding_point_override: null,
		note: "本地示例，以正式通知为准",
		created_at: timestamp,
		updated_at: timestamp,
		updated_by: actor,
		drop_off_point_override: null,
	}));
	rows["transport.schedule_items"] = [
		{
			item_id: "seed-fixed",
			schedule_id: "seed-schedule-0",
			kind: "fixed",
			boarding_point: null,
			departure_time: "08:00",
			first_departure_time: null,
			last_departure_time: null,
			interval_minutes: null,
			rider_type: "all",
			capacity: 45,
			note: null,
			sort_order: 0,
		},
		{
			item_id: "seed-interval",
			schedule_id: "seed-schedule-0",
			kind: "interval",
			boarding_point: null,
			departure_time: null,
			first_departure_time: "10:00",
			last_departure_time: "16:00",
			interval_minutes: 20,
			rider_type: "student",
			capacity: null,
			note: null,
			sort_order: 1,
		},
	];
	rows["transport.schedule_period_notices"] = [
		{ schedule_id: "seed-schedule-0", notice_id: 900002, summary: "凭校园卡乘车" },
	];
	const bundle = DINING_BOOTSTRAP_FLOORPLANS;
	const assets = renderDiningMapAssets(bundle);
	for (const asset of assets) {
		objects.set(`dining/floorplans/${asset.sha256.slice(7)}.svg`, {
			body: Buffer.from(asset.svgMarkup),
			contentType: "image/svg+xml",
		});
	}
	const releaseId = "local-seed-release";
	const payload = buildDiningMapResponse({ assets, bundle, releaseId, updatedAt: timestamp });
	rows["dining.map_draft"] = [
		{
			bundle_json: bundle,
			fingerprint: diningMapBundleFingerprint(bundle),
			revision: 1,
			scope: "global",
			updated_at: timestamp,
			updated_by: actor,
		},
	];
	rows["dining.map_releases"] = [
		{
			bundle_json: bundle,
			created_at: timestamp,
			created_by: actor,
			draft_revision: 1,
			kind: "publish",
			public_payload_json: payload,
			release_id: releaseId,
			restored_from_release_id: null,
			snapshot_hash: diningMapBundleFingerprint(bundle),
		},
	];
	rows["dining.map_publication"] = [
		{ release_id: releaseId, scope: "global", updated_at: timestamp, updated_by: actor },
	];
	const window = payload.halls.flatMap((hall) => hall.floors).flatMap((floor) => floor.windows)[0];
	if (!window) {
		throw new Error("Seed dining map has no window");
	}
	rows["dining.menu_items"] = [
		{
			archived_at: null,
			created_at: timestamp,
			created_by: actor,
			menu_item_id: "seed-noodles",
			name: "热汤面（本地示例）",
			price_text: "10 元",
			sort_order: 0,
			updated_at: timestamp,
			updated_by: actor,
			window_id: window.windowId,
		},
	];
	const reviews = [
		{
			anonymous: false,
			author_display_name: "本地示例同学",
			author_id: "local-seed-reviewer",
			author_kind: "member",
			body: "热汤面分量充足，夜宵时段也能吃到。",
			content_revision: 1,
			created_at: timestamp,
			deleted_at: null,
			deleted_by: null,
			edited_at: null,
			hidden_at: null,
			hidden_by: null,
			idempotency_key: "local-seed-review",
			menu_item_id: "seed-noodles",
			review_id: "local-seed-review",
			submission_date: date,
			updated_at: timestamp,
			updated_by: actor,
		},
	];
	return { rows, objects, sourceObjects, reviews };
}

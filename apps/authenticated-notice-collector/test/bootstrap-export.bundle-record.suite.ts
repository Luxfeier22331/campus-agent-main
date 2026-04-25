import { expect, it } from "vitest";

import { buildBundleRecord } from "../src/bootstrap-export";

export function registerBootstrapExportBundleRecordSuite() {
	it("builds importer-compatible bundle records from list and detail payloads", () => {
		const record = buildBundleRecord({
			detailInfo: {
				notice_content: "<p>请同学们于4月10日前完成报名。</p>",
				notice_id: 355119,
				notice_link: "https://portal.example.edu/notice/355119",
				notice_link_state: 0,
				notice_release_time: "2026-04-02 18:49",
				notice_source: 1,
				notice_state: 1,
				notice_stick: 0,
			},
			observedAt: "2026-04-04T01:23:45.000Z",
			notice: {
				notice_id: 355119,
				notice_title: "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
				notice_type: "6",
				notice_type_name: "教学通知",
				organization_id: "00001",
				organization_name: "教务处",
			},
		});

		expect(record).toEqual({
			attachments: [],
			links: [],
			notice: {
				categories: [
					{
						category_first_seen_at: "2026-04-04T01:23:45.000Z",
						category_last_run_id: null,
						category_last_seen_at: "2026-04-04T01:23:45.000Z",
						notice_id: 355119,
						notice_type: "6",
						notice_type_name: "教学通知",
					},
				],
				enrich_attempted_at: "2026-04-04T01:23:45.000Z",
				last_seen_at: "2026-04-04T01:23:45.000Z",
				notice_content: "<p>请同学们于4月10日前完成报名。</p>",
				notice_create_time: null,
				notice_first_time: null,
				notice_id: 355119,
				notice_link: "https://portal.example.edu/notice/355119",
				notice_link_state: 0,
				notice_release_time: "2026-04-02 18:49",
				notice_source: 1,
				notice_state: 1,
				notice_stick: 0,
				notice_title: "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
				organization_id: "00001",
				organization_name: "教务处",
			},
			notice_attachments: [],
			notice_id: 355119,
		});
	});

	it("extracts reference-only links and attachment refs from notice html", () => {
		const record = buildBundleRecord({
			detailInfo: {
				notice_content:
					'<p>附件下载：<a href="/files/application.docx">报名表.docx</a></p><p>咨询邮箱：<a href="mailto:help@example.edu">help@example.edu</a></p>',
				notice_id: 355119,
			},
			observedAt: "2026-04-04T01:23:45.000Z",
			notice: {
				notice_id: 355119,
				notice_title: "通知标题",
				notice_type: "5",
				notice_type_name: "办公通知",
			},
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(record.links).toHaveLength(2);
		expect(record.links[0]).toMatchObject({
			collect_policy: "reference_only",
			content_kind: "attachment_list",
			final_url: "https://portal.example.edu/files/application.docx",
			link_scope: "internal",
			link_text: "报名表.docx",
			url_scheme: "https",
		});
		expect(record.links[1]).toMatchObject({
			collect_policy: "skip_scheme",
			final_url: null,
			link_scope: "unsupported",
			link_text: "help@example.edu",
			skip_reason: "unsupported_scheme",
			url_scheme: "mailto",
		});
		expect(record.notice_attachments).toEqual([
			{
				anchor_text: "报名表.docx",
				attachment_id: 1,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: 1,
				notice_id: 355119,
				relation_source: "content",
				resource_role: "attachment",
			},
		]);
		expect(record.attachments).toEqual([
			{
				attachment_id: 1,
				bucket: null,
				byte_size: null,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: null,
				etag: null,
				final_url: "https://portal.example.edu/files/application.docx",
				ingest_status: "reference_only",
				last_error: null,
				local_path: null,
				mime_type: null,
				normalized_source_url: "https://portal.example.edu/files/application.docx",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "application.docx",
				provenance_status: "reference_only",
				sha256: null,
				source_url: "https://portal.example.edu/files/application.docx",
				storage_provider: "reference_only",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: null,
				version_id: null,
			},
		]);
	});

	it("extracts inline image attachment refs from notice html", () => {
		const record = buildBundleRecord({
			detailInfo: {
				notice_content:
					'<p>小篮球场东、西两侧（见附件红色区域）停车位。</p><p><img src="http://portal.example.edu:80/comsys-portal-notice-web/upload/ueditor/2026413/red-zone.png" alt="红色区域图.png"/></p>',
				notice_id: 355549,
			},
			observedAt: "2026-04-04T01:23:45.000Z",
			notice: {
				notice_id: 355549,
				notice_title: "关于暂时停用相关区域停车权限的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
			},
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(record.links).toHaveLength(1);
		expect(record.links[0]).toMatchObject({
			collect_policy: "reference_only",
			content_kind: "inline_image",
			final_url:
				"http://portal.example.edu/comsys-portal-notice-web/upload/ueditor/2026413/red-zone.png",
			link_scope: "internal",
			link_text: "红色区域图.png",
			url_scheme: "http",
		});
		expect(record.notice_attachments).toEqual([
			{
				anchor_text: "红色区域图.png",
				attachment_id: 1,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: 1,
				notice_id: 355549,
				relation_source: "content",
				resource_role: "inline_image",
			},
		]);
		expect(record.attachments).toEqual([
			{
				attachment_id: 1,
				bucket: null,
				byte_size: null,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: null,
				etag: null,
				final_url:
					"http://portal.example.edu/comsys-portal-notice-web/upload/ueditor/2026413/red-zone.png",
				ingest_status: "reference_only",
				last_error: null,
				local_path: null,
				mime_type: null,
				normalized_source_url:
					"http://portal.example.edu/comsys-portal-notice-web/upload/ueditor/2026413/red-zone.png",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "http",
				original_filename: "red-zone.png",
				provenance_status: "reference_only",
				sha256: null,
				source_url:
					"http://portal.example.edu/comsys-portal-notice-web/upload/ueditor/2026413/red-zone.png",
				storage_provider: "reference_only",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: null,
				version_id: null,
			},
		]);
	});

	it("extracts reference-only attachment refs from notice detail annex list", () => {
		const record = buildBundleRecord({
			detailInfo: {
				home_url: "https://portal.example.edu/home",
				notice_annext: [
					{
						notice_annex_id: "c46da95c-464c-4faf-8415-11974c33d3a4",
						notice_annex_name: "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
					},
				],
				notice_content: "<p>通知正文</p>",
				notice_id: 355282,
			},
			observedAt: "2026-04-04T01:23:45.000Z",
			notice: {
				notice_id: 355282,
				notice_title: "关于学生使用人工智能的指导意见",
				notice_type: "5",
				notice_type_name: "办公通知",
			},
		});

		expect(record.links).toEqual([]);
		expect(record.notice_attachments).toEqual([
			{
				anchor_text: "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
				attachment_id: 1,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: null,
				notice_id: 355282,
				relation_source: "detail_api",
				resource_role: "attachment",
			},
		]);
		expect(record.attachments).toEqual([
			{
				attachment_id: 1,
				bucket: null,
				byte_size: null,
				created_at: "2026-04-04T01:23:45.000Z",
				downloaded_at: null,
				etag: null,
				final_url:
					"https://portal.example.edu/comsys-portal-notice-web/download?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282",
				ingest_status: "reference_only",
				last_error: null,
				local_path: null,
				mime_type: null,
				normalized_source_url:
					"https://portal.example.edu/comsys-portal-notice-web/download?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
				provenance_status: "reference_only",
				sha256: null,
				source_url:
					"https://portal.example.edu/comsys-portal-notice-web/download?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282",
				storage_provider: "reference_only",
				updated_at: "2026-04-04T01:23:45.000Z",
				uploaded_at: null,
				version_id: null,
			},
		]);
	});

	it("deduplicates detail annex attachments already linked in html", () => {
		const record = buildBundleRecord({
			detailInfo: {
				home_url: "https://portal.example.edu/home",
				notice_annext: [
					{
						notice_annex_id: "ac84e8d1-c32e-4023-81fa-fae84e10216b",
						notice_annex_name: "中央民族大学新一轮本科教育教学审核评估应知应会手册.pdf",
					},
				],
				notice_content:
					'<p>附件：<a href="/comsys-portal-notice-web/download?id=ac84e8d1-c32e-4023-81fa-fae84e10216b&notice_id=351704">中央民族大学新一轮本科教育教学审核评估应知应会手册.pdf</a></p>',
				notice_id: 351704,
			},
			observedAt: "2026-04-04T01:23:45.000Z",
			notice: {
				notice_id: 351704,
				notice_title: "审核评估应知应会手册",
				notice_type: "5",
				notice_type_name: "办公通知",
			},
		});

		expect(record.links).toHaveLength(1);
		expect(record.attachments).toHaveLength(1);
		expect(record.notice_attachments).toEqual([
			{
				anchor_text: "中央民族大学新一轮本科教育教学审核评估应知应会手册.pdf",
				attachment_id: 1,
				discovered_at: "2026-04-04T01:23:45.000Z",
				link_id: 1,
				notice_id: 351704,
				relation_source: "content",
				resource_role: "attachment",
			},
		]);
	});
}

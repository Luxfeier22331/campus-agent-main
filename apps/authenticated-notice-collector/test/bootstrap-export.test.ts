import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBundleRecord, collectBootstrapBundle, writeBootstrapArtifacts } from "../src/bootstrap-export";
import type { NoticeTypeConfig } from "../src/types";

describe("authenticated notice collector bootstrap export", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

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

  it("collects list/detail pages into a deduplicated bootstrap bundle and disposes the api context", async () => {
    const detailCalls: number[] = [];
    let disposed = false;
    const noticeTypes: NoticeTypeConfig[] = [
      {
        type: "5",
        name: "办公通知",
        enabled: true,
        incrementalPages: 1,
        incrementalPageSize: 2,
        backfillPages: 1,
        backfillPageSize: 20,
      },
      {
        type: "6",
        name: "教学通知",
        enabled: true,
        incrementalPages: 1,
        incrementalPageSize: 2,
        backfillPages: 1,
        backfillPageSize: 20,
      },
    ];

    const result = await collectBootstrapBundle({
      createApiContext: async () => ({
        dispose: async () => {
          disposed = true;
        },
        post: async () => {
          throw new Error("unexpected post");
        },
      }),
      exportedAt: "2026-04-04T01:23:45.000Z",
      fetchNoticeDetail: async ({ noticeId }) => {
        detailCalls.push(noticeId);
        return {
          datas: {
            notice_info: {
              notice_content: `<p>${noticeId}</p>`,
              notice_id: noticeId,
              notice_link: `https://portal.example.edu/notice/${noticeId}`,
              notice_link_state: 0,
              notice_release_time: "2026-04-02 18:49",
              notice_source: 1,
              notice_state: 1,
              notice_stick: 0,
            },
          },
          state: true,
        };
      },
      fetchNoticePage: async ({ noticeType }) => {
        if (noticeType === "5") {
          return {
            datas: {
              page: {
                totalCounts: 1,
              },
              tables: [
                {
                  notice_id: 355119,
                  notice_title: "通知 A",
                  notice_type: "5",
                  notice_type_name: "办公通知",
                },
                {
                  notice_id: 355120,
                  notice_title: "通知 B",
                  notice_type: "5",
                  notice_type_name: "办公通知",
                },
              ],
            },
            state: true,
          };
        }

        return {
          datas: {
            page: {
              totalCounts: 1,
            },
            tables: [
              {
                notice_id: 355119,
                notice_title: "通知 A",
                notice_type: "6",
                notice_type_name: "教学通知",
              },
            ],
          },
          state: true,
        };
      },
      noticeTypes,
      requestBackoffBaseMs: 1,
      requestMaxRetries: 3,
      siteId: "muc_internal_portal",
      sourceHomeUrl: "https://portal.example.edu/home",
    });

    expect(detailCalls).toEqual([355119, 355120]);
    expect(disposed).toBe(true);
    expect(result.stats).toEqual({
      detailFetched: 2,
      noticesCollected: 2,
      pagesFetched: 2,
    });
    expect(result.bundleRecords).toHaveLength(2);
    expect(result.bundleRecords[0]?.notice.categories).toEqual([
      {
        category_first_seen_at: "2026-04-04T01:23:45.000Z",
        category_last_run_id: null,
        category_last_seen_at: "2026-04-04T01:23:45.000Z",
        notice_id: 355119,
        notice_type: "5",
        notice_type_name: "办公通知",
      },
      {
        category_first_seen_at: "2026-04-04T01:23:45.000Z",
        category_last_run_id: null,
        category_last_seen_at: "2026-04-04T01:23:45.000Z",
        notice_id: 355119,
        notice_type: "6",
        notice_type_name: "教学通知",
      },
    ]);
    expect(result.exportManifest.run.items_seen).toBe(3);
    expect(result.exportManifest.run.items_inserted).toBe(2);
    expect(result.exportManifest.notice_type_policy).toEqual([
      {
        backfill: {
          page_size: 20,
          pages: 1,
        },
        enabled: true,
        incremental: {
          page_size: 2,
          pages: 1,
        },
        name: "办公通知",
        type: "5",
      },
      {
        backfill: {
          page_size: 20,
          pages: 1,
        },
        enabled: true,
        incremental: {
          page_size: 2,
          pages: 1,
        },
        name: "教学通知",
        type: "6",
      },
    ]);
    expect(result.exportManifest.collector).toEqual({
      attachment_collection_mode: "html_reference_only",
      attachment_storage_mode: "reference_only",
      export_contract_version: "authenticated_notice_collector_export_v2",
      link_collection_mode: "html_reference_only",
      runtime_shell: "repo_local_node",
    });
  });

  it("writes notices bundle and export manifest under the configured exports directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-bootstrap-export-"));
    tempDirs.push(tempDir);

    const written = writeBootstrapArtifacts({
      bundleRecords: [
        buildBundleRecord({
          detailInfo: {
            notice_content: "<p>通知正文</p>",
            notice_id: 355119,
            notice_link: "https://portal.example.edu/notice/355119",
          },
          observedAt: "2026-04-04T01:23:45.000Z",
          notice: {
            notice_id: 355119,
            notice_title: "通知标题",
            notice_type: "5",
            notice_type_name: "办公通知",
          },
        }),
      ],
      exportManifest: {
        export_date: "20260404",
        export_scope: "bootstrap-20260404T012345Z",
        exported_at: "2026-04-04T01:23:45.000Z",
        filters: {
          max_notices: null,
          notice_types: ["5"],
        },
        collector: {
          attachment_collection_mode: "html_reference_only",
          attachment_storage_mode: "reference_only",
          export_contract_version: "authenticated_notice_collector_export_v2",
          link_collection_mode: "html_reference_only",
          runtime_shell: "repo_local_node",
        },
        notice_type_policy: [
          {
            backfill: {
              page_size: 20,
              pages: 1,
            },
            enabled: true,
            incremental: {
              page_size: 20,
              pages: 1,
            },
            name: "办公通知",
            type: "5",
          },
        ],
        run: {
          detail_fetched: 1,
          errors: 0,
          finished_at: "2026-04-04T01:23:45.000Z",
          items_inserted: 1,
          items_seen: 1,
          mode: "bootstrap_export",
          pages_fetched: 1,
          started_at: "2026-04-04T01:23:45.000Z",
          status: "success",
        },
        schema_version: "authenticated_notice_collector_export_v2",
        site_id: "muc_internal_portal",
        source_channel: "authenticated_notice_portal",
        source_home_url: "https://portal.example.edu/home",
      },
      outputDir: tempDir,
    });

    expect(path.basename(written.bundlePath)).toBe("notices-bundle-20260404T012345Z.json");
    expect(path.basename(written.manifestPath)).toBe("export-manifest-20260404T012345Z.json");
    expect(JSON.parse(fs.readFileSync(written.bundlePath, "utf-8"))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(written.manifestPath, "utf-8")).site_id).toBe("muc_internal_portal");
  });
});

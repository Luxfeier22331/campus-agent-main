import { describe, expect, it, vi } from "vitest";

import {
	assertAttachmentContentAccepted,
	assertAttachmentRunSizeAccepted,
	materializeBundleAttachments,
} from "../src/attachment-materialization.js";
import type { BundleNoticeRecord } from "../src/types.js";

describe("authenticated notice attachment content admission", () => {
	it("rejects an HTML login response for an internal attachment", () => {
		expect(() =>
			assertAttachmentContentAccepted({
				contentType: "text/html",
				fetchMode: "portal_internal",
				filename: "schedule.pdf",
			}),
		).toThrow("attachment_html_response_rejected:text/html");
	});

	it("rejects executable attachment extensions", () => {
		expect(() =>
			assertAttachmentContentAccepted({
				contentType: "application/octet-stream",
				fetchMode: "portal_internal",
				filename: "installer.exe",
			}),
		).toThrow("attachment_executable_rejected:.exe");
	});

	it("rejects a run whose aggregate attachment bytes exceed 1 GiB", () => {
		expect(() => assertAttachmentRunSizeAccepted(1024 * 1024 * 1024 + 1)).toThrow(
			"attachment_run_size_limit_exceeded:1073741825",
		);
	});

	it("preserves a retryable source failure from an internal attachment", async () => {
		const apiContext = {
			get: vi.fn(async () => ({
				body: async () => Buffer.alloc(0),
				headers: () => ({}),
				json: async () => ({}),
				ok: () => false,
				status: () => 503,
				statusText: () => "Service Unavailable",
			})),
			post: vi.fn(async () => {
				throw new Error("unexpected post");
			}),
		};

		await expect(
			materializeBundleAttachments({
				apiContext,
				artifactStore: {
					storageProvider: "object_store",
					createOrVerifyObject: vi.fn(),
					headObject: vi.fn(),
				},
				bundleRecords: [internalAttachmentBundle()],
				observedAt: "2026-07-17T00:00:00.000Z",
				requestMaxRetries: 0,
				siteId: "muc_internal_portal",
			}),
		).rejects.toMatchObject({ code: "internal_portal_source_deferred" });
	});
});

function internalAttachmentBundle(): BundleNoticeRecord {
	const observedAt = "2026-07-17T00:00:00.000Z";
	const sourceUrl = "https://portal.example.edu/download/1";
	return {
		notice_id: 1,
		notice: {
			categories: [],
			enrich_attempted_at: observedAt,
			last_seen_at: observedAt,
			notice_browser_url: null,
			notice_browser_url_source: "unavailable",
			notice_content: "<p>正文</p>",
			notice_create_time: observedAt,
			notice_first_time: observedAt,
			notice_id: 1,
			notice_link: null,
			notice_link_state: null,
			notice_release_time: observedAt,
			notice_source: null,
			notice_state: null,
			notice_stick: null,
			notice_title: "通知",
			organization_id: null,
			organization_name: null,
			portal_print_url: null,
		},
		links: [],
		notice_attachments: [
			{
				anchor_text: "附件",
				attachment_id: 1,
				discovered_at: observedAt,
				link_id: null,
				notice_id: 1,
				relation_source: "detail_api",
				resource_role: "attachment",
			},
		],
		attachments: [
			{
				attachment_id: 1,
				bucket: null,
				byte_size: null,
				created_at: observedAt,
				downloaded_at: null,
				etag: null,
				final_url: sourceUrl,
				ingest_status: "reference_only",
				last_error: null,
				local_path: null,
				mime_type: null,
				normalized_source_url: sourceUrl,
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "notice.pdf",
				provenance_status: "reference_only",
				sha256: null,
				source_url: sourceUrl,
				storage_provider: "reference_only",
				updated_at: observedAt,
				uploaded_at: null,
				version_id: null,
			},
		],
	};
}

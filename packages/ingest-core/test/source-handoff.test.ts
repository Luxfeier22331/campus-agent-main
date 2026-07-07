import { describe, expect, it } from "vitest";
import {
	assertObjectRefsUseBucket,
	buildAuthenticatedFileReleaseSourceTruthKeys,
	buildAuthenticatedNoticeSourceTruthKeys,
	buildCanonicalVersionDigest,
	deriveFileReleaseBundleKeyForManifest,
	joinObjectKeySegments,
	parseAuthenticatedFileReleaseManifest,
	parseAuthenticatedNoticeCaptureRelease,
	parseOfficialWebSourceTruthBundle,
	parseSourceObjectRefList,
	parseWeChatOfficialAccountCaptureRelease,
} from "../src/index.ts";

describe("source-channel handoff helpers", () => {
	it("parses authenticated notice capture releases and verifies referenced bucket", () => {
		const release = parseAuthenticatedNoticeCaptureRelease({
			schema_version: "authenticated_notice_capture_release.v1",
			source_channel: "internal_portal",
			source_surface: "notice",
			site_id: "synthetic_internal_portal",
			capture_id: "capture-001",
			exported_at: "2026-04-04T01:23:45.000Z",
			bundle_ref: { bucket: "campus-agent-source", key: "notice/bundle.json" },
			export_manifest_ref: {
				bucket: "campus-agent-source",
				key: "notice/export-manifest.json",
			},
		});

		expect(release.siteId).toBe("synthetic_internal_portal");
		expect(release.bundleRef.key).toBe("notice/bundle.json");
		expect(release.exportManifestRef.key).toBe("notice/export-manifest.json");
		expect(() =>
			assertObjectRefsUseBucket(
				[release.bundleRef, release.exportManifestRef],
				"campus-agent-source",
			),
		).not.toThrow();
		expect(() => assertObjectRefsUseBucket([release.bundleRef], "other-bucket")).toThrow(
			"object refs must use bucket other-bucket",
		);
	});

	it("parses file-release manifests and derives sibling bundle keys", () => {
		const manifest = parseAuthenticatedFileReleaseManifest({
			schema_version: "internal_portal_file_release_export_v1",
			source_channel: "internal_portal",
			source_surface: "file_release",
			site_id: "synthetic_internal_portal",
			source_home_url: "https://example.edu/files",
			exported_at: "2026-04-12T00:30:00.000Z",
		});

		expect(manifest.siteId).toBe("synthetic_internal_portal");
		expect(
			deriveFileReleaseBundleKeyForManifest(
				"internal_portal/runs/site/20260412/file-releases-manifest.json",
			),
		).toBe("internal_portal/runs/site/20260412/file-releases-bundle.json");
		expect(() => deriveFileReleaseBundleKeyForManifest("bad/manifest.json")).toThrow(
			"file-release task input_ref must point at file-releases-manifest.json",
		);
	});

	it("parses official web bundles and WeChat capture releases", () => {
		const officialWebBundle = parseOfficialWebSourceTruthBundle({
			schemaVersion: "official_web_source_truth_bundle.v1",
			sourceChannel: "official_web",
			crawlRunId: "owrun_01",
			pages: [
				{
					pageManifestObjectKey: "official_web/page-manifest.json",
					contentBlocksObjectKey: "official_web/content-blocks.jsonl",
				},
			],
		});
		expect(officialWebBundle.pages[0]?.pageManifestObjectKey).toBe(
			"official_web/page-manifest.json",
		);

		const wechatRelease = parseWeChatOfficialAccountCaptureRelease({
			schema_version: "wechat_official_account_capture_release.v1",
			source_channel: "wechat_official_account",
			account_slug: "muc_tuanwei",
			capture_run_id: "wcrun_01",
			captured_at: "2026-04-04T01:23:45.000Z",
			article_source_truth_refs: [
				{
					article_stable_id: "article_01",
					raw_asset_id: "asset:wechat:muc_tuanwei:article_01",
					raw_version_id: "raw_01",
					manifest_ref: { bucket: "campus-agent-source", key: "wechat/manifest.json" },
					content_blocks_ref: {
						bucket: "campus-agent-source",
						key: "wechat/content-blocks.jsonl",
					},
					media_refs_ref: { bucket: "campus-agent-source", key: "wechat/media-refs.jsonl" },
				},
			],
		});

		expect(wechatRelease.captureRunId).toBe("wcrun_01");
		expect(wechatRelease.articleRefs[0]?.manifestRef.key).toBe("wechat/manifest.json");
	});

	it("builds safe object keys and deterministic source-truth paths", () => {
		expect(joinObjectKeySegments("internal_portal", "asset:notice:1", "source-truth")).toBe(
			"internal_portal/asset:notice:1/source-truth",
		);
		expect(() => joinObjectKeySegments("internal_portal", "../bad")).toThrow(
			"object key segment must not contain ..",
		);
		expect(buildCanonicalVersionDigest({ b: 2, a: 1 })).toBe(
			buildCanonicalVersionDigest({ a: 1, b: 2 }),
		);
		expect(
			buildAuthenticatedNoticeSourceTruthKeys({
				rawAssetId: "asset:authenticated-notice:site:355119",
				rawVersionId: `sha256:${"0".repeat(64)}`,
				year: "2026",
			}),
		).toEqual({
			attachmentRefsKey:
				"internal_portal/asset:authenticated-notice:site:355119/2026/00/0000000000000000000000000000000000000000000000000000000000000000/source-truth/attachment-refs.jsonl",
			contentBlocksKey:
				"internal_portal/asset:authenticated-notice:site:355119/2026/00/0000000000000000000000000000000000000000000000000000000000000000/source-truth/content-blocks.jsonl",
			manifestKey:
				"internal_portal/asset:authenticated-notice:site:355119/2026/00/0000000000000000000000000000000000000000000000000000000000000000/source-truth/notice-manifest.json",
		});
		expect(
			buildAuthenticatedFileReleaseSourceTruthKeys({
				fileReleaseId: 646,
				rawVersionId: `sha256:${"1".repeat(64)}`,
				year: "2026",
			}).manifestKey,
		).toBe(
			"internal_portal/file-release-646/2026/sha256:1111111111111111111111111111111111111111111111111111111111111111/source-truth/file-release-manifest.json",
		);
	});

	it("parses source object refs from records", () => {
		const refs = parseSourceObjectRefList(
			[
				{ bucket: "source", key: "a.json", role: "manifest" },
				{ bucket: "source", key: "b.jsonl", content_sha256: "0".repeat(64) },
			],
			"refs",
		);

		expect(refs).toHaveLength(2);
		expect(refs[1]?.contentSha256).toBe("0".repeat(64));
		expect(() => parseSourceObjectRefList("bad", "refs")).toThrow("refs must be an array");
	});

	it("reports concrete schema paths for invalid source-channel handoff payloads", () => {
		expect(() =>
			parseAuthenticatedNoticeCaptureRelease({
				schema_version: "authenticated_notice_capture_release.v1",
				source_channel: "internal_portal",
				source_surface: "file_release",
				site_id: "synthetic_internal_portal",
				capture_id: "capture-001",
				exported_at: "2026-04-04T01:23:45.000Z",
				bundle_ref: { bucket: "campus-agent-source", key: "notice/bundle.json" },
				export_manifest_ref: {
					bucket: "campus-agent-source",
					key: "notice/export-manifest.json",
				},
			}),
		).toThrow("capture release.source_surface");

		expect(() =>
			parseWeChatOfficialAccountCaptureRelease({
				schema_version: "wechat_official_account_capture_release.v1",
				source_channel: "wechat_official_account",
				account_slug: "muc_tuanwei",
				capture_run_id: "wcrun_01",
				captured_at: "2026-04-04T01:23:45.000Z",
				article_source_truth_refs: [
					{
						article_stable_id: "article_01",
						raw_asset_id: "asset:wechat:muc_tuanwei:article_01",
						raw_version_id: "raw_01",
						manifest_ref: { bucket: "campus-agent-source", key: "../bad.json" },
						content_blocks_ref: {
							bucket: "campus-agent-source",
							key: "wechat/content-blocks.jsonl",
						},
						media_refs_ref: { bucket: "campus-agent-source", key: "wechat/media-refs.jsonl" },
					},
				],
			}),
		).toThrow("WeChat capture release.article_source_truth_refs[0].manifest_ref.key");
	});
});

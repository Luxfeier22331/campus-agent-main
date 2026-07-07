import type { IngestionArtifactRef, IngestionTaskEnvelope } from "ingestion-contracts";
import { z } from "zod";

import {
	assertOptionalSha256Digest,
	assertSha256Digest,
	buildObjectStoreArtifactRef,
	buildS3Uri,
	formatZodIssues,
	type ObjectStoreReader,
	parseJsonObjectBytes,
	parseS3Uri,
	type SourceObjectRef,
	SourceObjectRefPayloadSchema,
	sha256Hex,
} from "./core.ts";

export interface AuthenticatedNoticeCaptureRelease {
	bundleRef: SourceObjectRef;
	captureId: string;
	exportManifestRef: SourceObjectRef;
	exportedAt: string;
	siteId: string;
}

export interface AuthenticatedFileReleaseManifest {
	exportedAt: string;
	siteId: string;
	sourceHomeUrl: string;
}

export interface OfficialWebSourceTruthBundlePage {
	contentBlocksObjectKey: string;
	pageManifestObjectKey: string;
}

export interface OfficialWebSourceTruthBundle {
	crawlRunId: string;
	pages: OfficialWebSourceTruthBundlePage[];
	sourceChannel: string;
}

export interface WeChatOfficialAccountArticleSourceTruthRef {
	articleStableId: string;
	contentBlocksRef: SourceObjectRef;
	manifestRef: SourceObjectRef;
	mediaRefsRef: SourceObjectRef;
	rawAssetId: string;
	rawVersionId: string;
}

export interface WeChatOfficialAccountCaptureRelease {
	accountSlug: string;
	articleRefs: WeChatOfficialAccountArticleSourceTruthRef[];
	captureRunId: string;
	capturedAt: string;
}

const SafeObjectKeySchema = z
	.string()
	.trim()
	.min(1)
	.refine((value) => !(value.startsWith("/") || value.split("/").includes("..")), {
		message: "must be a relative object key without .. segments",
	});

const SourceObjectRefListSchema = z.array(SourceObjectRefPayloadSchema);

const AuthenticatedNoticeCaptureReleaseSchema = z.object({
	bundle_ref: SourceObjectRefPayloadSchema,
	capture_id: z.string().trim().min(1),
	export_manifest_ref: SourceObjectRefPayloadSchema,
	exported_at: z.string().trim().min(1),
	schema_version: z.literal("authenticated_notice_capture_release.v1"),
	site_id: z.string().trim().min(1),
	source_channel: z.literal("internal_portal"),
	source_surface: z.literal("notice"),
});

const AuthenticatedFileReleaseManifestSchema = z.object({
	exported_at: z.string().trim().min(1),
	schema_version: z.literal("internal_portal_file_release_export_v1"),
	site_id: z.string().trim().min(1),
	source_channel: z.literal("internal_portal"),
	source_home_url: z.string().trim().min(1),
	source_surface: z.literal("file_release"),
});

const OfficialWebSourceTruthBundleSchema = z.object({
	crawlRunId: z.string().trim().min(1),
	pages: z.array(
		z.object({
			contentBlocksObjectKey: SafeObjectKeySchema,
			pageManifestObjectKey: SafeObjectKeySchema,
		}),
	),
	schemaVersion: z.literal("official_web_source_truth_bundle.v1"),
	sourceChannel: z.string().trim().min(1),
});

const WeChatOfficialAccountArticleSourceTruthRefSchema = z.object({
	article_stable_id: z.string().trim().min(1),
	content_blocks_ref: SourceObjectRefPayloadSchema,
	manifest_ref: SourceObjectRefPayloadSchema,
	media_refs_ref: SourceObjectRefPayloadSchema,
	raw_asset_id: z.string().trim().min(1),
	raw_version_id: z.string().trim().min(1),
});

const WeChatOfficialAccountCaptureReleaseSchema = z.object({
	account_slug: z.string().trim().min(1),
	article_source_truth_refs: z.array(WeChatOfficialAccountArticleSourceTruthRefSchema),
	captured_at: z.string().trim().min(1),
	capture_run_id: z.string().trim().min(1),
	schema_version: z.literal("wechat_official_account_capture_release.v1"),
	source_channel: z.literal("wechat_official_account"),
});

export function parseAuthenticatedNoticeCaptureRelease(
	value: unknown,
): AuthenticatedNoticeCaptureRelease {
	const parsed = AuthenticatedNoticeCaptureReleaseSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`capture release is invalid: ${formatZodIssues(parsed.error.issues, "capture release").join("; ")}`,
		);
	}
	return {
		bundleRef: parsed.data.bundle_ref,
		captureId: parsed.data.capture_id,
		exportManifestRef: parsed.data.export_manifest_ref,
		exportedAt: parsed.data.exported_at,
		siteId: parsed.data.site_id,
	};
}

export function parseAuthenticatedFileReleaseManifest(
	value: unknown,
): AuthenticatedFileReleaseManifest {
	const parsed = AuthenticatedFileReleaseManifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`file-release manifest is invalid: ${formatZodIssues(parsed.error.issues, "file-release manifest").join("; ")}`,
		);
	}
	return {
		exportedAt: parsed.data.exported_at,
		siteId: parsed.data.site_id,
		sourceHomeUrl: parsed.data.source_home_url,
	};
}

export function parseOfficialWebSourceTruthBundle(value: unknown): OfficialWebSourceTruthBundle {
	const parsed = OfficialWebSourceTruthBundleSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`official web source truth bundle is invalid: ${formatZodIssues(parsed.error.issues, "official web source truth bundle").join("; ")}`,
		);
	}
	return {
		crawlRunId: parsed.data.crawlRunId,
		pages: parsed.data.pages,
		sourceChannel: parsed.data.sourceChannel,
	};
}

export function parseWeChatOfficialAccountCaptureRelease(
	value: unknown,
): WeChatOfficialAccountCaptureRelease {
	const parsed = WeChatOfficialAccountCaptureReleaseSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`WeChat capture release is invalid: ${formatZodIssues(parsed.error.issues, "WeChat capture release").join("; ")}`,
		);
	}
	return {
		accountSlug: parsed.data.account_slug,
		articleRefs: parsed.data.article_source_truth_refs.map((articleRef) => ({
			articleStableId: articleRef.article_stable_id,
			contentBlocksRef: articleRef.content_blocks_ref,
			manifestRef: articleRef.manifest_ref,
			mediaRefsRef: articleRef.media_refs_ref,
			rawAssetId: articleRef.raw_asset_id,
			rawVersionId: articleRef.raw_version_id,
		})),
		capturedAt: parsed.data.captured_at,
		captureRunId: parsed.data.capture_run_id,
	};
}

export function parseSourceObjectRefList(value: unknown, label: string): SourceObjectRef[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	const parsed = SourceObjectRefListSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`${label} is invalid: ${formatZodIssues(parsed.error.issues, label).join("; ")}`,
		);
	}
	return parsed.data;
}

export function assertObjectRefsUseBucket(
	refs: readonly SourceObjectRef[],
	bucket: string,
	message = `object refs must use bucket ${bucket}`,
): void {
	if (refs.some((ref) => ref.bucket !== bucket)) {
		throw new Error(message);
	}
}

export async function resolveOfficialWebSourceTruthRefsFromTask(input: {
	objectStore: ObjectStoreReader;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const bundleInput = parseS3Uri(input.task.input_ref);
	const bundleBytes = await input.objectStore.getObject(bundleInput);
	const bundleDigest = sha256Hex(bundleBytes);
	assertSha256Digest({
		actualSha256: bundleDigest,
		digest: input.task.input_ref.digest,
		label: "official web source truth bundle input_ref",
	});
	const bundle = parseOfficialWebSourceTruthBundle(
		parseJsonObjectBytes(bundleBytes, "official web source truth bundle"),
	);
	if (bundle.sourceChannel !== "official_web") {
		throw new Error("official web source truth bundle sourceChannel must be official_web");
	}
	if (bundle.crawlRunId !== input.task.run_id) {
		throw new Error("official web source truth bundle crawlRunId must match task run_id");
	}

	const refs: IngestionArtifactRef[] = [
		buildObjectStoreArtifactRef({
			bucket: bundleInput.bucket,
			key: bundleInput.key,
			contentSha256: bundleDigest,
		}),
	];
	const seen = new Set<string>();
	for (const page of bundle.pages) {
		for (const key of [page.pageManifestObjectKey, page.contentBlocksObjectKey]) {
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			await input.objectStore.getObject({
				bucket: bundleInput.bucket,
				key,
			});
			refs.push({
				kind: "object_store",
				uri: buildS3Uri({ bucket: bundleInput.bucket, key }),
			});
		}
	}
	return refs;
}

export async function resolveWeChatOfficialAccountSourceTruthRefsFromTask(input: {
	objectStore: ObjectStoreReader;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const sourceInput = parseS3Uri(input.task.input_ref);
	const releaseBytes = await input.objectStore.getObject(sourceInput);
	const releaseDigest = sha256Hex(releaseBytes);
	assertOptionalSha256Digest({
		actualSha256: releaseDigest,
		digest: input.task.input_ref.digest,
		label: "WeChat capture release input_ref",
	});
	const release = parseWeChatOfficialAccountCaptureRelease(
		parseJsonObjectBytes(releaseBytes, "WeChat capture release"),
	);
	if (release.captureRunId !== input.task.run_id) {
		throw new Error("WeChat capture release capture_run_id must match task run_id");
	}

	const refs: IngestionArtifactRef[] = [
		buildObjectStoreArtifactRef({
			bucket: sourceInput.bucket,
			key: sourceInput.key,
			contentSha256: releaseDigest,
		}),
	];
	for (const articleRef of release.articleRefs) {
		for (const [field, objectRef] of [
			["manifest_ref", articleRef.manifestRef],
			["content_blocks_ref", articleRef.contentBlocksRef],
			["media_refs_ref", articleRef.mediaRefsRef],
		] as const) {
			assertObjectRefsUseBucket(
				[objectRef],
				sourceInput.bucket,
				"WeChat capture release object refs must use the source bucket",
			);
			const objectBytes = await input.objectStore.getObject({
				bucket: objectRef.bucket,
				key: objectRef.key,
			});
			verifySourceObjectRefBytes(objectRef, objectBytes, `WeChat ${field}`);
			refs.push(
				buildObjectStoreArtifactRef({
					bucket: objectRef.bucket,
					key: objectRef.key,
					contentSha256: sha256Hex(objectBytes),
				}),
			);
		}
	}
	return refs;
}

export function deriveFileReleaseBundleKeyForManifest(manifestKey: string): string {
	const marker = "/file-releases-manifest.json";
	if (!manifestKey.endsWith(marker)) {
		throw new Error("file-release task input_ref must point at file-releases-manifest.json");
	}
	return `${manifestKey.slice(0, -marker.length)}/file-releases-bundle.json`;
}

function verifySourceObjectRefBytes(
	ref: { byteSize?: number | null; contentSha256?: string | null },
	bytes: Uint8Array,
	label: string,
): void {
	if (ref.byteSize !== undefined && ref.byteSize !== null && ref.byteSize !== bytes.byteLength) {
		throw new Error(`${label} byte_size mismatch`);
	}
	if (!ref.contentSha256) {
		throw new Error(`${label} content_sha256 is required`);
	}
	if (ref.contentSha256 !== sha256Hex(bytes)) {
		throw new Error(`${label} content_sha256 mismatch`);
	}
}

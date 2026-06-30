import type { IngestionTaskEnvelope } from "ingestion-contracts";

import type { WeChatOfficialAccountCaptureArtifactRef } from "./capture.ts";

export interface WeChatOfficialAccountCaptureRelease {
	schema_version: "wechat_official_account_capture_release.v1";
	source_channel: "wechat_official_account";
	account_slug: string;
	capture_run_id: string;
	captured_at: string;
	article_source_truth_refs: WeChatOfficialAccountArticleSourceTruthReleaseRef[];
}

export interface WeChatOfficialAccountArticleSourceTruthReleaseRef {
	article_stable_id: string;
	raw_asset_id: string;
	raw_version_id: string;
	manifest_ref: WeChatOfficialAccountReleaseObjectRef;
	content_blocks_ref: WeChatOfficialAccountReleaseObjectRef;
	media_refs_ref: WeChatOfficialAccountReleaseObjectRef;
}

export interface WeChatOfficialAccountReleaseObjectRef {
	bucket: string;
	key: string;
	content_sha256: string;
	byte_size: number;
	record_count?: number;
}

export interface WeChatOfficialAccountIngestionControlClient {
	admitTask(input: IngestionTaskEnvelope): Promise<{ task_id: string; status: string }>;
}

export function buildWeChatOfficialAccountCaptureRelease(input: {
	accountSlug: string;
	artifacts: WeChatOfficialAccountCaptureArtifactRef[];
	capturedAt: string;
	captureRunId: string;
	sourceBucket: string;
}): WeChatOfficialAccountCaptureRelease {
	const refsByVersion = new Map<
		string,
		Partial<
			Pick<
				WeChatOfficialAccountArticleSourceTruthReleaseRef,
				"content_blocks_ref" | "manifest_ref" | "media_refs_ref"
			>
		> & {
			article_stable_id: string;
			raw_asset_id: string;
			raw_version_id: string;
		}
	>();
	for (const artifact of input.artifacts) {
		const field = sourceTruthArtifactField(artifact.artifactType);
		if (!field) {
			continue;
		}
		const rawVersionId = extractRawVersionId(artifact.objectKey);
		const existing =
			refsByVersion.get(rawVersionId) ??
			({
				article_stable_id: "unknown",
				raw_asset_id: "unknown",
				raw_version_id: rawVersionId,
			} as const);
		refsByVersion.set(rawVersionId, {
			...existing,
			[field]: toReleaseObjectRef({
				artifact,
				sourceBucket: input.sourceBucket,
			}),
		});
	}

	return {
		schema_version: "wechat_official_account_capture_release.v1",
		source_channel: "wechat_official_account",
		account_slug: input.accountSlug,
		capture_run_id: input.captureRunId,
		captured_at: input.capturedAt,
		article_source_truth_refs: [...refsByVersion.values()].map((ref) => {
			if (!(ref.manifest_ref && ref.content_blocks_ref && ref.media_refs_ref)) {
				throw new Error(`incomplete WeChat source-truth refs for ${ref.raw_version_id}`);
			}
			return {
				article_stable_id: ref.article_stable_id,
				raw_asset_id: ref.raw_asset_id,
				raw_version_id: ref.raw_version_id,
				manifest_ref: ref.manifest_ref,
				content_blocks_ref: ref.content_blocks_ref,
				media_refs_ref: ref.media_refs_ref,
			};
		}),
	};
}

export function buildWeChatOfficialAccountSourceTruthTask(input: {
	captureReleaseContentSha256: string;
	captureReleaseKey: string;
	captureRunId: string;
	createdAt: string;
	sourceBucket: string;
}): IngestionTaskEnvelope {
	return {
		schema_version: "ingestion_task_envelope.v1",
		task_id: `task_wechat_public_notice_source_truth_${sanitizeTaskIdPart(input.captureRunId)}`,
		run_id: input.captureRunId,
		source_family: "wechat_public_notice",
		source_channel: "wechat_official_account",
		corpus: "campus_notices",
		collection: "wechat_public_notice",
		task_kind: "source_truth_materialize",
		input_ref: {
			kind: "object_store",
			uri: `s3://${input.sourceBucket}/${input.captureReleaseKey}`,
			digest: `sha256:${input.captureReleaseContentSha256}`,
		},
		output_contract: "wechat_official_account_source_truth.v1",
		idempotency_key: `campus_notices/wechat_public_notice/source_truth_materialize/${input.captureRunId}`,
		lease_policy: {
			lease_seconds: 300,
			heartbeat_seconds: 30,
		},
		retry_policy: {
			max_attempts: 3,
		},
		created_by: "wechat-official-account-collector",
		created_at: input.createdAt,
	};
}

export function createWeChatOfficialAccountIngestionControlClient(input: {
	baseUrl?: string | null;
	fetchImplementation?: typeof fetch;
}): WeChatOfficialAccountIngestionControlClient {
	const baseUrl = input.baseUrl?.trim();
	if (!baseUrl) {
		throw new Error("INGESTION_CONTROL_BASE_URL is required for WeChat task admission.");
	}
	const fetchImplementation = input.fetchImplementation ?? fetch;
	return {
		async admitTask(task) {
			const url = new URL("/internal/ingestion/tasks", baseUrl);
			const response = await fetchImplementation(url.toString(), {
				body: JSON.stringify(task),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			});
			if (!response.ok) {
				throw new Error(`ingestion-control task admission returned ${response.status}`);
			}
			const parsed = (await response.json()) as Record<string, unknown>;
			const taskId = typeof parsed.task_id === "string" ? parsed.task_id.trim() : "";
			const status = typeof parsed.status === "string" ? parsed.status.trim() : "";
			if (!(taskId && status)) {
				throw new Error("ingestion-control task admission returned an invalid task response");
			}
			return {
				task_id: taskId,
				status,
			};
		},
	};
}

function sourceTruthArtifactField(
	artifactType: WeChatOfficialAccountCaptureArtifactRef["artifactType"],
): "content_blocks_ref" | "manifest_ref" | "media_refs_ref" | null {
	if (artifactType === "source_truth_article_manifest") {
		return "manifest_ref";
	}
	if (artifactType === "source_truth_content_blocks") {
		return "content_blocks_ref";
	}
	if (artifactType === "source_truth_media_refs") {
		return "media_refs_ref";
	}
	return null;
}

function toReleaseObjectRef(input: {
	artifact: WeChatOfficialAccountCaptureArtifactRef;
	sourceBucket: string;
}): WeChatOfficialAccountReleaseObjectRef {
	return {
		bucket: input.sourceBucket,
		key: input.artifact.objectKey,
		content_sha256: input.artifact.contentSha256,
		byte_size: input.artifact.byteSize,
		record_count: input.artifact.recordCount,
	};
}

function extractRawVersionId(objectKey: string): string {
	const parts = objectKey.split("/");
	if (parts.length < 5) {
		throw new Error(`invalid WeChat source-truth object key: ${objectKey}`);
	}
	return parts[3];
}

function sanitizeTaskIdPart(value: string): string {
	return value.replace(/[^A-Za-z0-9_:-]+/gu, "_");
}

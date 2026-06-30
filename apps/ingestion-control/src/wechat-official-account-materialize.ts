import { createHash } from "node:crypto";

import type { IngestionObjectStore } from "./authenticated-notice-materialize";
import type { TsTaskHandler, TsTaskHandlerResult } from "./task-executor";
import type { IngestionArtifactRef, IngestionTaskRecord } from "./types";

const SOURCE_CHANNEL = "wechat_official_account";
const CAPTURE_RELEASE_SCHEMA = "wechat_official_account_capture_release.v1";

export function createWeChatOfficialAccountSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => {
		const sourceInput = parseS3Uri(task.input_ref);
		const releaseBytes = await input.objectStore.getObject(sourceInput);
		const releaseDigest = sha256(releaseBytes);
		validateInputDigest({
			actualSha256: releaseDigest,
			digest: task.input_ref.digest,
			label: "WeChat capture release input_ref",
			required: false,
		});
		const release = asRecord(JSON.parse(textFromBytes(releaseBytes)), "WeChat capture release");
		validateCaptureRelease({ release, task });
		const refs: IngestionArtifactRef[] = [
			{
				kind: "object_store",
				uri: task.input_ref.uri,
				digest: `sha256:${releaseDigest}`,
			},
		];
		for (const articleRef of asArray(
			release.article_source_truth_refs,
			"WeChat article_source_truth_refs",
		).map((item) => asRecord(item, "WeChat article source truth ref"))) {
			for (const field of ["manifest_ref", "content_blocks_ref", "media_refs_ref"]) {
				const objectRef = requiredSourceObjectRef(articleRef[field], field);
				if (objectRef.bucket !== sourceInput.bucket) {
					throw new Error("WeChat capture release object refs must use the source bucket");
				}
				const objectBytes = await input.objectStore.getObject({
					bucket: objectRef.bucket,
					key: objectRef.key,
				});
				verifyObjectRefBytes(objectRef, objectBytes, field);
				refs.push({
					kind: "object_store",
					uri: `s3://${objectRef.bucket}/${objectRef.key}`,
					digest: `sha256:${sha256(objectBytes)}`,
				});
			}
		}
		return { artifactRefs: refs };
	};
}

function validateCaptureRelease(input: {
	release: Record<string, unknown>;
	task: IngestionTaskRecord;
}): void {
	if (requiredText(input.release.schema_version, "schema_version") !== CAPTURE_RELEASE_SCHEMA) {
		throw new Error("WeChat capture release schema_version is invalid");
	}
	if (requiredText(input.release.source_channel, "source_channel") !== SOURCE_CHANNEL) {
		throw new Error("WeChat capture release source_channel must be wechat_official_account");
	}
	if (requiredText(input.release.capture_run_id, "capture_run_id") !== input.task.run_id) {
		throw new Error("WeChat capture release capture_run_id must match task run_id");
	}
	requiredText(input.release.account_slug, "account_slug");
	requiredText(input.release.captured_at, "captured_at");
	asArray(input.release.article_source_truth_refs, "WeChat article_source_truth_refs");
}

function parseS3Uri(ref: IngestionArtifactRef): { bucket: string; key: string } {
	if (ref.kind !== "object_store") {
		throw new Error(`input_ref must be object_store, got ${ref.kind}`);
	}
	if (!ref.uri.startsWith("s3://")) {
		throw new Error(`input_ref object_store uri must use s3://, got ${ref.uri}`);
	}
	const rest = ref.uri.slice("s3://".length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		throw new Error(`invalid s3 uri: ${ref.uri}`);
	}
	return {
		bucket: rest.slice(0, slash),
		key: rest.slice(slash + 1),
	};
}

function requiredSourceObjectRef(
	value: unknown,
	field: string,
): {
	bucket: string;
	contentSha256: string | null;
	key: string;
} {
	const ref = asRecord(value, field);
	const bucket = requiredText(ref.bucket, `${field}.bucket`);
	const key = requiredText(ref.key, `${field}.key`);
	const contentSha256 = optionalText(ref.content_sha256);
	if (key.startsWith("/") || key.includes("..")) {
		throw new Error(`invalid WeChat source truth object key: ${key}`);
	}
	return {
		bucket,
		contentSha256,
		key,
	};
}

function verifyObjectRefBytes(
	ref: { contentSha256: string | null; key: string },
	body: Uint8Array,
	field: string,
): void {
	if (!ref.contentSha256) {
		throw new Error(`WeChat ${field} content_sha256 is required`);
	}
	if (ref.contentSha256 !== sha256(body)) {
		throw new Error(`WeChat ${field} content_sha256 mismatch`);
	}
}

function validateInputDigest(input: {
	actualSha256: string;
	digest: string | undefined;
	label: string;
	required: boolean;
}): void {
	if (!input.digest?.trim()) {
		if (input.required) {
			throw new Error(`${input.label} digest is required`);
		}
		return;
	}
	if (!input.digest.startsWith("sha256:")) {
		throw new Error(`${input.label} digest must use sha256`);
	}
	if (input.digest.slice("sha256:".length) !== input.actualSha256) {
		throw new Error(`${input.label} digest mismatch`);
	}
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value;
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value;
}

function requiredText(value: unknown, field: string): string {
	const text = optionalText(value);
	if (!text) {
		throw new Error(`WeChat capture release ${field} is required`);
	}
	return text;
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromBytes(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8");
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

import { createHash } from "node:crypto";

import type { OfficialWebSourceTruthBundle } from "official-web-core";

import type { IngestionObjectStore } from "./authenticated-notice-materialize";
import type { TsTaskHandler, TsTaskHandlerResult } from "./task-executor";
import type { IngestionArtifactRef } from "./types";

const OFFICIAL_WEB_SOURCE_CHANNEL = "official_web";
const SOURCE_TRUTH_BUNDLE_ARTIFACT_TYPE = "source_truth_bundle";

export function createOfficialWebSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => {
		const handoffInput = parseS3Uri(task.input_ref);
		const handoff = asRecord(
			JSON.parse(textFromBytes(await input.objectStore.getObject(handoffInput))),
			"official web handoff",
		);
		validateOfficialWebHandoff({ handoff, taskRunId: task.run_id });
		const sourceTruthBundleRef = requiredArtifactSummary(
			handoff,
			SOURCE_TRUTH_BUNDLE_ARTIFACT_TYPE,
		);
		const bundleBytes = await readSameBucketObject({
			bucket: handoffInput.bucket,
			key: sourceTruthBundleRef.objectKey,
			objectStore: input.objectStore,
		});
		verifyArtifactSummaryBytes({
			artifact: sourceTruthBundleRef,
			bytes: bundleBytes,
			label: SOURCE_TRUTH_BUNDLE_ARTIFACT_TYPE,
		});
		const bundle = asOfficialWebSourceTruthBundle(JSON.parse(textFromBytes(bundleBytes)));
		validateOfficialWebSourceTruthBundle({
			bundle,
			siteId: requiredText(handoff.siteId, "siteId"),
			runId: task.run_id,
		});

		const refs: IngestionArtifactRef[] = [
			{
				kind: "object_store",
				uri: `s3://${handoffInput.bucket}/${sourceTruthBundleRef.objectKey}`,
				digest: `sha256:${sourceTruthBundleRef.contentSha256}`,
			},
		];
		const seen = new Set<string>();
		for (const page of bundle.pages) {
			for (const key of [page.pageManifestObjectKey, page.contentBlocksObjectKey]) {
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				await readSameBucketObject({
					bucket: handoffInput.bucket,
					key,
					objectStore: input.objectStore,
				});
				refs.push({
					kind: "object_store",
					uri: `s3://${handoffInput.bucket}/${key}`,
				});
			}
		}
		return { artifactRefs: refs };
	};
}

function validateOfficialWebHandoff(input: {
	handoff: Record<string, unknown>;
	taskRunId: string;
}): void {
	if (input.handoff.sourceChannel !== OFFICIAL_WEB_SOURCE_CHANNEL) {
		throw new Error("official web handoff sourceChannel must be official_web");
	}
	if (input.handoff.runId !== input.taskRunId) {
		throw new Error("official web handoff runId must match task run_id");
	}
	const eventType = requiredText(input.handoff.eventType, "eventType");
	if (!eventType.startsWith("official_web.run.")) {
		throw new Error("official web handoff eventType must be terminal official_web run event");
	}
}

function validateOfficialWebSourceTruthBundle(input: {
	bundle: OfficialWebSourceTruthBundle;
	siteId: string;
	runId: string;
}): void {
	if (input.bundle.sourceChannel !== OFFICIAL_WEB_SOURCE_CHANNEL) {
		throw new Error("official web source truth bundle sourceChannel must be official_web");
	}
	if (input.bundle.siteId !== input.siteId) {
		throw new Error("official web source truth bundle siteId must match handoff siteId");
	}
	if (input.bundle.crawlRunId !== input.runId) {
		throw new Error("official web source truth bundle crawlRunId must match task run_id");
	}
}

function requiredArtifactSummary(
	handoff: Record<string, unknown>,
	artifactType: string,
): {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
} {
	const artifacts = asArray(handoff.artifacts, "artifacts").filter(isRecord);
	const artifact = artifacts.find((item) => item.artifactType === artifactType);
	if (!artifact) {
		throw new Error(`official web handoff missing ${artifactType} artifact`);
	}
	return {
		artifactType,
		byteSize: optionalNumber(artifact.byteSize),
		contentSha256: requiredText(artifact.contentSha256, `${artifactType}.contentSha256`),
		objectKey: requiredText(artifact.objectKey, `${artifactType}.objectKey`),
		recordCount: optionalNumber(artifact.recordCount),
	};
}

function verifyArtifactSummaryBytes(input: {
	artifact: { byteSize: number | null; contentSha256: string };
	bytes: Uint8Array;
	label: string;
}): void {
	if (input.artifact.byteSize !== null && input.artifact.byteSize !== input.bytes.byteLength) {
		throw new Error(`${input.label} byteSize mismatch`);
	}
	if (input.artifact.contentSha256 !== sha256(input.bytes)) {
		throw new Error(`${input.label} contentSha256 mismatch`);
	}
}

async function readSameBucketObject(input: {
	bucket: string;
	key: string;
	objectStore: IngestionObjectStore;
}): Promise<Uint8Array> {
	if (input.key.startsWith("/") || input.key.includes("..")) {
		throw new Error(`invalid official web object key: ${input.key}`);
	}
	return input.objectStore.getObject({
		bucket: input.bucket,
		key: input.key,
	});
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

function asOfficialWebSourceTruthBundle(value: unknown): OfficialWebSourceTruthBundle {
	const bundle = asRecord(value, "official web source truth bundle");
	if (bundle.schemaVersion !== "official_web_source_truth_bundle.v1") {
		throw new Error("official web source truth bundle schemaVersion is invalid");
	}
	const pages = asArray(bundle.pages, "official web source truth bundle pages").filter(isRecord);
	for (const page of pages) {
		requiredText(page.pageManifestObjectKey, "pageManifestObjectKey");
		requiredText(page.contentBlocksObjectKey, "contentBlocksObjectKey");
	}
	return bundle as unknown as OfficialWebSourceTruthBundle;
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string): string {
	const normalized = String(value ?? "").trim();
	if (!normalized) {
		throw new Error(`${label} is required`);
	}
	return normalized;
}

function optionalNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return value;
}

function textFromBytes(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8");
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

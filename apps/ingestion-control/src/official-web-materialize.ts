import { createHash } from "node:crypto";

import type { OfficialWebSourceTruthBundle } from "official-web-core";

import type { IngestionObjectStore } from "./authenticated-notice-materialize";
import type { TsTaskHandler, TsTaskHandlerResult } from "./task-executor";
import type { IngestionArtifactRef } from "./types";

const OFFICIAL_WEB_SOURCE_CHANNEL = "official_web";

export function createOfficialWebSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => {
		const bundleInput = parseS3Uri(task.input_ref);
		const bundleBytes = await input.objectStore.getObject(bundleInput);
		const bundleDigest = sha256(bundleBytes);
		validateInputDigest({
			actualSha256: bundleDigest,
			digest: task.input_ref.digest,
		});
		const bundle = asOfficialWebSourceTruthBundle(JSON.parse(textFromBytes(bundleBytes)));
		validateOfficialWebSourceTruthBundle({
			bundle,
			runId: task.run_id,
		});

		const refs: IngestionArtifactRef[] = [
			{
				kind: "object_store",
				uri: task.input_ref.uri,
				digest: `sha256:${bundleDigest}`,
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
					bucket: bundleInput.bucket,
					key,
					objectStore: input.objectStore,
				});
				refs.push({
					kind: "object_store",
					uri: `s3://${bundleInput.bucket}/${key}`,
				});
			}
		}
		return { artifactRefs: refs };
	};
}

function validateInputDigest(input: { actualSha256: string; digest: string | undefined }): void {
	if (!input.digest?.trim()) {
		throw new Error("official web source truth bundle input_ref digest is required");
	}
	if (!input.digest.startsWith("sha256:")) {
		throw new Error("official web source truth bundle input_ref digest must use sha256");
	}
	if (input.digest.slice("sha256:".length) !== input.actualSha256) {
		throw new Error("official web source truth bundle input_ref digest mismatch");
	}
}

function validateOfficialWebSourceTruthBundle(input: {
	bundle: OfficialWebSourceTruthBundle;
	runId: string;
}): void {
	if (input.bundle.sourceChannel !== OFFICIAL_WEB_SOURCE_CHANNEL) {
		throw new Error("official web source truth bundle sourceChannel must be official_web");
	}
	if (input.bundle.crawlRunId !== input.runId) {
		throw new Error("official web source truth bundle crawlRunId must match task run_id");
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
		requiredText(page, "pageManifestObjectKey");
		requiredText(page, "contentBlocksObjectKey");
	}
	return bundle as unknown as OfficialWebSourceTruthBundle;
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

function requiredText(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`official web source truth bundle page ${field} is required`);
	}
	return value;
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

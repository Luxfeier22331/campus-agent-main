import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import type { StoredArtifactRef as CoreStoredArtifactRef } from "ingest-core";
import { assertStoredArtifactIdentity, sha256Hex } from "ingest-core";
import { createOrVerifyS3Object } from "../../../src/s3-create-or-verify.ts";

export type StoredArtifactRef = CoreStoredArtifactRef;

export interface OfficialWebArtifactStore {
	close?(): Promise<void> | void;
	createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef>;
}

export class FilesystemArtifactStore implements OfficialWebArtifactStore {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	async createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const targetPath = resolve(this.rootDir, input.objectKey);
		mkdirSync(dirname(targetPath), { recursive: true });
		const contentSha256 = sha256Hex(input.data);
		try {
			writeFileSync(targetPath, input.data, { flag: "wx" });
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
				throw error;
			}
			const existing = readFileSync(targetPath);
			assertStoredArtifactIdentity({
				actualByteSize: existing.byteLength,
				actualContentSha256: sha256Hex(existing),
				expectedByteSize: input.data.byteLength,
				expectedContentSha256: contentSha256,
				uri: targetPath,
			});
		}
		return {
			objectKey: input.objectKey,
			contentSha256,
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

export class S3ArtifactStore implements OfficialWebArtifactStore {
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;

	constructor(input: {
		bucket: string;
		client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;
	}) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	close(): void {
		this.client.destroy?.();
	}

	async createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const stored = await createOrVerifyS3Object({
			abortSignal: input.abortSignal,
			body: input.data,
			bucket: this.bucket,
			client: this.client,
			contentType: input.contentType,
			key: input.objectKey,
		});
		return {
			objectKey: input.objectKey,
			contentSha256: stored.contentSha256,
			byteSize: stored.byteSize,
			etag: stored.etag,
			versionId: stored.versionId,
			recordCount: input.recordCount,
		};
	}
}

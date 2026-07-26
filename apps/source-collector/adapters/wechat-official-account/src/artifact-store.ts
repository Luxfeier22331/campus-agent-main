import type { S3Client } from "@aws-sdk/client-s3";
import type { StoredArtifactRef as CoreStoredArtifactRef } from "ingest-core";
import { createOrVerifyS3Object } from "../../../src/s3-create-or-verify.ts";

export type StoredArtifactRef = CoreStoredArtifactRef;

export interface WeChatOfficialAccountArtifactStore {
	close?(): Promise<void> | void;
	createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef>;
}

export class S3WeChatOfficialAccountArtifactStore implements WeChatOfficialAccountArtifactStore {
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

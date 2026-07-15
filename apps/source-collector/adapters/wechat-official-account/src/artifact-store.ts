import { S3Client } from "@aws-sdk/client-s3";
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

export interface WeChatOfficialAccountObjectStoreEnvironment {
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
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

export function createWeChatOfficialAccountArtifactStoreFromEnv(
	env: WeChatOfficialAccountObjectStoreEnvironment = process.env,
): WeChatOfficialAccountArtifactStore | undefined {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const accessKey = env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim();
	const secretKey = env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim();
	const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;

	if (configuredCount === 0) {
		return;
	}
	if (!(endpoint && accessKey && secretKey)) {
		throw new Error(
			"OBJECT_STORE_ENDPOINT plus OBJECT_STORE_SOURCE_ACCESS_KEY/OBJECT_STORE_SOURCE_SECRET_KEY are required.",
		);
	}

	return new S3WeChatOfficialAccountArtifactStore({
		bucket: env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source",
		client: new S3Client({
			endpoint,
			region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
			credentials: {
				accessKeyId: accessKey,
				secretAccessKey: secretKey,
			},
			forcePathStyle: true,
		}),
	});
}

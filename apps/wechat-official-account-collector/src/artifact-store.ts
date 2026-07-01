import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StoredArtifactRef {
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	recordCount?: number;
}

export interface WeChatOfficialAccountArtifactStore {
	putObject(input: {
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
	private readonly client: Pick<S3Client, "send">;

	constructor(input: { bucket: string; client: Pick<S3Client, "send"> }) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: input.objectKey,
				Body: input.data,
				ContentType: input.contentType,
			}),
		);
		return {
			objectKey: input.objectKey,
			contentSha256: createHash("sha256").update(input.data).digest("hex"),
			byteSize: input.data.byteLength,
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

import { createHash } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { IngestionObjectStore } from "./authenticated-notice-materialize";

export interface IngestionObjectStoreEnvironment {
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

export function createS3IngestionObjectStore(input: {
	bucket: string;
	client: Pick<S3Client, "send">;
}): IngestionObjectStore {
	return new S3IngestionObjectStore(input);
}

export function createS3IngestionObjectStoreFromEnv(
	env: IngestionObjectStoreEnvironment = process.env,
): IngestionObjectStore | undefined {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const accessKey = env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim();
	const secretKey = env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim();
	const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;

	if (configuredCount === 0) {
		return;
	}
	if (!(endpoint && accessKey && secretKey)) {
		throw new Error(
			"OBJECT_STORE_ENDPOINT plus OBJECT_STORE_SOURCE_ACCESS_KEY and OBJECT_STORE_SOURCE_SECRET_KEY are required for source-bucket ingestion tasks.",
		);
	}

	return createS3IngestionObjectStore({
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

class S3IngestionObjectStore implements IngestionObjectStore {
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send">;

	constructor(input: { bucket: string; client: Pick<S3Client, "send"> }) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		this.requireBucket(input.bucket);
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: input.bucket,
				Key: input.key,
			}),
		);
		const body = result.Body;
		if (!body) {
			throw new Error(`object body missing: s3://${input.bucket}/${input.key}`);
		}
		if (typeof body.transformToByteArray === "function") {
			return body.transformToByteArray();
		}
		throw new Error(`object body is not byte-readable: s3://${input.bucket}/${input.key}`);
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		this.requireBucket(input.bucket);
		const contentSha256 = createHash("sha256").update(input.body).digest("hex");
		await this.client.send(
			new PutObjectCommand({
				Bucket: input.bucket,
				Key: input.key,
				Body: input.body,
				ContentLength: input.body.byteLength,
				ContentType: input.contentType,
				Metadata: {
					"content-sha256": contentSha256,
				},
			}),
		);
		return {
			byteSize: input.body.byteLength,
			contentSha256,
		};
	}

	private requireBucket(bucket: string): void {
		if (bucket !== this.bucket) {
			throw new Error(`object bucket mismatch: expected ${this.bucket}, got ${bucket}`);
		}
	}
}

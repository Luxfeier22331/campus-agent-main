import { createHash } from "node:crypto";
import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export interface PublisherObjectStore {
	close(): void;
	createOrVerifyDerived(input: { body: Uint8Array; contentType: string; digest: string }): Promise<void>;
	getSource(key: string): Promise<{ body: Uint8Array; contentType: string | null }>;
	listSource(prefix: string): Promise<string[]>;
}

export function createPublisherObjectStoreFromEnv(env: NodeJS.ProcessEnv): PublisherObjectStore {
	const client = new S3Client({
		credentials: { accessKeyId: required(env, "OBJECT_STORE_ACCESS_KEY"), secretAccessKey: required(env, "OBJECT_STORE_SECRET_KEY") },
		endpoint: required(env, "OBJECT_STORE_ENDPOINT"), forcePathStyle: true, maxAttempts: 1,
		region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
	});
	const sourceBucket = env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source";
	const derivedBucket = required(env, "OBJECT_STORE_BUCKET_DERIVED");
	return {
		close: () => client.destroy(),
		async createOrVerifyDerived(input) {
			const key = `notices/assets/sha256/${input.digest}`;
			try {
				const existing = await getBytes(client, derivedBucket, key);
				if (sha256(existing) !== input.digest) throw new Error(`derived object conflicts: ${key}`);
				return;
			} catch (error) {
				if (!isNotFound(error)) throw error;
			}
			await client.send(new PutObjectCommand({ Body: input.body, Bucket: derivedBucket, ContentLength: input.body.byteLength, ContentType: input.contentType, IfNoneMatch: "*", Key: key, Metadata: { "content-sha256": input.digest } }));
		},
		async getSource(key) {
			return getObject(client, sourceBucket, key);
		},
		async listSource(prefix) {
			const keys: string[] = []; let token: string | undefined;
			do {
				const page = await client.send(new ListObjectsV2Command({ Bucket: sourceBucket, ContinuationToken: token, Prefix: prefix }));
				keys.push(...(page.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
				if (page.IsTruncated && !page.NextContinuationToken) throw new Error("source listing is truncated without continuation token");
				token = page.IsTruncated ? page.NextContinuationToken : undefined;
			} while (token);
			return keys;
		},
	};
}

async function getBytes(client: S3Client, bucket: string, key: string): Promise<Uint8Array> {
	return (await getObject(client, bucket, key)).body;
}
async function getObject(client: S3Client, bucket: string, key: string): Promise<{ body: Uint8Array; contentType: string | null }> {
	const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!result.Body) throw new Error(`object body is missing: ${key}`);
	return { body: await result.Body.transformToByteArray(), contentType: result.ContentType?.trim() || null };
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function required(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`${key} is required`); return value; }
function isNotFound(error: unknown): boolean { const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }; return value?.name === "NoSuchKey" || value?.name === "NotFound" || value?.$metadata?.httpStatusCode === 404; }

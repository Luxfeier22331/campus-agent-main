import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export interface PublisherObjectStore {
	close(): void;
	/** Writes a content-addressed asset; an existing object under the digest key already holds these bytes. */
	createDerivedAsset(input: {
		body: Uint8Array;
		contentType: string;
		digest: string;
	}): Promise<void>;
	getSource(key: string): Promise<{ body: Uint8Array; contentType: string | null }>;
	getSourceIfExists(
		key: string,
	): Promise<{ body: Uint8Array; contentType: string | null } | null>;
}

export function createPublisherObjectStoreFromEnv(env: NodeJS.ProcessEnv): PublisherObjectStore {
	const endpoint = required(env, "OBJECT_STORE_ENDPOINT");
	const region = env.OBJECT_STORE_REGION?.trim() || "us-east-1";
	const sourceBucket = env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source";
	const derivedBucket = required(env, "OBJECT_STORE_BUCKET_DERIVED");
	const sourceCredentials = {
		accessKeyId: required(env, "OBJECT_STORE_SOURCE_ACCESS_KEY"),
		secretAccessKey: required(env, "OBJECT_STORE_SOURCE_SECRET_KEY"),
	};
	const derivedCredentials = {
		accessKeyId: required(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		secretAccessKey: required(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
	};
	const sourceClient = new S3Client({
		credentials: sourceCredentials,
		endpoint,
		forcePathStyle: true,
		maxAttempts: 1,
		region,
	});
	const derivedClient = new S3Client({
		credentials: derivedCredentials,
		endpoint,
		forcePathStyle: true,
		maxAttempts: 1,
		region,
	});
	return {
		close() {
			sourceClient.destroy();
			derivedClient.destroy();
		},
		async createDerivedAsset(input) {
			try {
				await derivedClient.send(
					new PutObjectCommand({
						Body: input.body,
						Bucket: derivedBucket,
						ContentLength: input.body.byteLength,
						ContentType: input.contentType,
						IfNoneMatch: "*",
						Key: `notices/assets/sha256/${input.digest}`,
					}),
				);
			} catch (error) {
				if (!isPreconditionFailure(error)) {
					throw error;
				}
			}
		},
		async getSource(key) {
			return getObject(sourceClient, sourceBucket, key);
		},
		async getSourceIfExists(key) {
			try {
				return await getObject(sourceClient, sourceBucket, key);
			} catch (error) {
				if (isNotFound(error)) {
					return null;
				}
				throw error;
			}
		},
	};
}

async function getObject(
	client: S3Client,
	bucket: string,
	key: string,
): Promise<{ body: Uint8Array; contentType: string | null }> {
	const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!result.Body) {
		throw new Error(`object body is missing: ${key}`);
	}
	return {
		body: await result.Body.transformToByteArray(),
		contentType: result.ContentType?.trim() || null,
	};
}
function required(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
function isNotFound(error: unknown): boolean {
	const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
	return (
		value?.name === "NoSuchKey" ||
		value?.name === "NotFound" ||
		value?.$metadata?.httpStatusCode === 404
	);
}
function isPreconditionFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const status =
		"$metadata" in error && error.$metadata && typeof error.$metadata === "object"
			? (error.$metadata as { httpStatusCode?: unknown }).httpStatusCode
			: undefined;
	return status === 412 || ("name" in error && error.name === "PreconditionFailed");
}

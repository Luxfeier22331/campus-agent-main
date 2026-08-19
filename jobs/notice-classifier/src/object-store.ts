import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export interface NoticeClassifierObjectStore {
	close(): void;
	getDerived(key: string): Promise<Uint8Array | null>;
	getSource(key: string): Promise<Uint8Array>;
	listSource(prefix: string): Promise<string[]>;
	putDerived(key: string, body: Uint8Array): Promise<void>;
}

export function createNoticeClassifierObjectStoreFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): NoticeClassifierObjectStore {
	const endpoint = required(env, "OBJECT_STORE_ENDPOINT");
	const region = env.OBJECT_STORE_REGION?.trim() || "us-east-1";
	const sourceBucket = env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source";
	const derivedBucket = required(env, "OBJECT_STORE_BUCKET_DERIVED");
	const sourceClient = new S3Client({
		credentials: {
			accessKeyId: required(env, "OBJECT_STORE_SOURCE_ACCESS_KEY"),
			secretAccessKey: required(env, "OBJECT_STORE_SOURCE_SECRET_KEY"),
		},
		endpoint,
		forcePathStyle: true,
		maxAttempts: 1,
		region,
	});
	const derivedClient = new S3Client({
		credentials: {
			accessKeyId: required(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
			secretAccessKey: required(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
		},
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
		getDerived: async (key) => {
			try {
				return await readObject(derivedClient, derivedBucket, key);
			} catch (error) {
				if (isNotFound(error)) return null;
				throw error;
			}
		},
		getSource: (key) => readObject(sourceClient, sourceBucket, key),
		listSource: (prefix) => listObjectKeys(sourceClient, sourceBucket, prefix),
		async putDerived(key, body) {
			await derivedClient.send(
				new PutObjectCommand({
					Body: body,
					Bucket: derivedBucket,
					ContentLength: body.byteLength,
					ContentType: "application/json",
					Key: key,
				}),
			);
		},
	};
}

async function readObject(client: S3Client, bucket: string, key: string): Promise<Uint8Array> {
	const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!result.Body) throw new Error(`object body is missing: ${key}`);
	return result.Body.transformToByteArray();
}

async function listObjectKeys(client: S3Client, bucket: string, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;
	do {
		const result = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				ContinuationToken: continuationToken,
				Prefix: prefix,
			}),
		);
		keys.push(...(result.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
		if (result.IsTruncated && !result.NextContinuationToken) {
			throw new Error("source listing is truncated without continuation token");
		}
		continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
	} while (continuationToken);
	return keys;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) throw new Error(`${key} is required`);
	return value;
}

function isNotFound(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const value = error as {
		$metadata?: { httpStatusCode?: number };
		Code?: string;
		code?: string;
		name?: string;
	};
	return (
		value.$metadata?.httpStatusCode === 404 ||
		value.name === "NotFound" ||
		value.name === "NoSuchKey" ||
		value.Code === "NoSuchKey" ||
		value.code === "NoSuchKey"
	);
}

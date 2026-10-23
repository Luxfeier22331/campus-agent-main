import { S3Client } from "@aws-sdk/client-s3";

export function createSourceObjectStoreConnection(env: Record<string, string | undefined>): {
	bucket: string;
	client: S3Client;
} {
	const bucket = requiredEnv(env, "OBJECT_STORE_BUCKET_SOURCE");
	const endpoint = requiredEnv(env, "OBJECT_STORE_ENDPOINT");
	const accessKeyId = requiredEnv(env, "OBJECT_STORE_SOURCE_ACCESS_KEY");
	const secretAccessKey = requiredEnv(env, "OBJECT_STORE_SOURCE_SECRET_KEY");
	return {
		bucket,
		client: new S3Client({
			endpoint,
			region: "us-east-1",
			credentials: { accessKeyId, secretAccessKey },
			forcePathStyle: true,
			maxAttempts: 1,
		}),
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

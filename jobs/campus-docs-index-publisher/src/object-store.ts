import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { ArtifactObjectStore } from "./types.ts";

export interface ObjectStoreEnv {
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	CAMPUS_DOCS_OBJECT_STORE_BUCKET?: string;
}

export function createS3ArtifactStore(env: ObjectStoreEnv = process.env): ArtifactObjectStore {
	const { bucket, client } = createS3Client(env);
	const read = async (key: string): Promise<Uint8Array> => {
		const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		if (!response.Body) throw new Error(`object body is missing: ${key}`);
		return response.Body.transformToByteArray();
	};
	return {
		read,
		async writeImmutable(key, body) {
			try {
				await client.send(new PutObjectCommand({
					Body: body,
					Bucket: bucket,
					ContentType: contentTypeForKey(key),
					IfNoneMatch: "*",
					Key: key,
				}));
			} catch (error) {
				if (!isPreconditionFailure(error)) throw error;
				const existing = await read(key);
				if (!Buffer.from(existing).equals(Buffer.from(body))) {
					throw new Error(`immutable object conflicts with existing content: ${key}`);
				}
			}
		},
	};
}

function createS3Client(env: ObjectStoreEnv) {
	const endpoint = requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT");
	const accessKeyId = requiredEnv(env.OBJECT_STORE_DERIVED_ACCESS_KEY, "OBJECT_STORE_DERIVED_ACCESS_KEY");
	const secretAccessKey = requiredEnv(env.OBJECT_STORE_DERIVED_SECRET_KEY, "OBJECT_STORE_DERIVED_SECRET_KEY");
	const bucket = env.CAMPUS_DOCS_OBJECT_STORE_BUCKET?.trim() || "campus-agent-derived";
	return {
		bucket,
		client: new S3Client({
			credentials: { accessKeyId, secretAccessKey },
			endpoint,
			forcePathStyle: true,
			region: "us-east-1",
		}),
	};
}

function contentTypeForKey(key: string): string {
	return key.endsWith(".ndjson") ? "application/x-ndjson" : "application/json";
}

function isPreconditionFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const status = "$metadata" in error && error.$metadata && typeof error.$metadata === "object"
		? (error.$metadata as { httpStatusCode?: unknown }).httpStatusCode
		: undefined;
	return status === 412 || ("name" in error && error.name === "PreconditionFailed");
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus docs publisher`);
	return normalized;
}

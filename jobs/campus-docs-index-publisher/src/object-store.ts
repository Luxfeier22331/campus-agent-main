import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { ArtifactObjectStore, ReaderObjectStore } from "./types.ts";

interface ObjectStoreConnectionEnv {
	OBJECT_STORE_ENDPOINT?: string;
}

export interface ObjectStoreEnv extends ObjectStoreConnectionEnv {
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
}

export interface ObjectStoreReaderEnv extends ObjectStoreConnectionEnv {
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_READ_SECRET_KEY?: string;
}

export function createS3ArtifactStore(env: ObjectStoreEnv = process.env): ArtifactObjectStore {
	const bucket = bucketFromEnv();
	const client = createS3Client({
		accessKeyId: requiredEnv(env.OBJECT_STORE_DERIVED_ACCESS_KEY, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		endpoint: requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT"),
		secretAccessKey: requiredEnv(env.OBJECT_STORE_DERIVED_SECRET_KEY, "OBJECT_STORE_DERIVED_SECRET_KEY"),
	});
	const read = async (key: string): Promise<Uint8Array> => {
		return readObject(client, bucket, key);
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

export function createS3ReaderStore(env: ObjectStoreReaderEnv = process.env): ReaderObjectStore {
	const bucket = bucketFromEnv();
	const client = createS3Client({
		accessKeyId: requiredEnv(
			env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
			"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		),
		endpoint: requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT"),
		secretAccessKey: requiredEnv(
			env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
			"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
		),
	});
	return {
		read: (key) => readObject(client, bucket, key),
	};
}

function createS3Client(input: {
	accessKeyId: string;
	endpoint: string;
	secretAccessKey: string;
}): S3Client {
	return new S3Client({
		credentials: {
			accessKeyId: input.accessKeyId,
			secretAccessKey: input.secretAccessKey,
		},
		endpoint: input.endpoint,
		forcePathStyle: true,
		region: "us-east-1",
	});
}

async function readObject(client: S3Client, bucket: string, key: string): Promise<Uint8Array> {
	const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!response.Body) throw new Error(`object body is missing: ${key}`);
	return response.Body.transformToByteArray();
}

function contentTypeForKey(key: string): string {
	return key.endsWith(".ndjson") ? "application/x-ndjson" : "application/json";
}

function bucketFromEnv(): string {
	return "campus-agent-derived";
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
	if (!normalized) throw new Error(`${name} is required for Campus docs object storage`);
	return normalized;
}

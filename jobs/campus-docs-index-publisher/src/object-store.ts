import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { ReaderObjectStore } from "./types.ts";

export interface ObjectStoreEnv {
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_READ_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	CAMPUS_DOCS_OBJECT_STORE_BUCKET?: string;
}

export function createS3ReaderStore(env: ObjectStoreEnv = process.env): ReaderObjectStore {
	const endpoint = requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT");
	const accessKeyId = requiredEnv(
		env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
	);
	const secretAccessKey = requiredEnv(
		env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
	);
	const bucket = (env.CAMPUS_DOCS_OBJECT_STORE_BUCKET?.trim() || "campus-agent-derived");
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region: "us-east-1",
	});
	return {
		async read(key: string): Promise<Uint8Array> {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
			if (!response.Body) throw new Error(`object body is missing: ${key}`);
			return response.Body.transformToByteArray();
		},
	};
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus docs publisher`);
	return normalized;
}

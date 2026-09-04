import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { NoticeArtifactStore } from "./types.ts";

export interface NoticeObjectStoreEnv {
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
}

export function createNoticeS3ArtifactStore(
	env: NoticeObjectStoreEnv = process.env,
): NoticeArtifactStore {
	const client = new S3Client({
		credentials: {
			accessKeyId: required(env.OBJECT_STORE_DERIVED_ACCESS_KEY, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
			secretAccessKey: required(
				env.OBJECT_STORE_DERIVED_SECRET_KEY,
				"OBJECT_STORE_DERIVED_SECRET_KEY",
			),
		},
		endpoint: required(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT"),
		forcePathStyle: true,
		region: "us-east-1",
	});
	const read = async (key: string): Promise<Uint8Array> => {
		const response = await client.send(
			new GetObjectCommand({ Bucket: "campus-agent-derived", Key: key }),
		);
		if (!response.Body) throw new Error(`notice artifact body is missing: ${key}`);
		return response.Body.transformToByteArray();
	};
	return {
		read,
		async writeImmutable(key, body) {
			try {
				await client.send(
					new PutObjectCommand({
						Body: body,
						Bucket: "campus-agent-derived",
						ContentType: key.endsWith(".ndjson")
							? "application/x-ndjson"
							: "application/json",
						IfNoneMatch: "*",
						Key: key,
					}),
				);
			} catch (error) {
				if (!isPreconditionFailure(error)) throw error;
				const existing = await read(key);
				if (!Buffer.from(existing).equals(Buffer.from(body))) {
					throw new Error(`immutable notice artifact conflicts with existing content: ${key}`);
				}
			}
		},
	};
}

function isPreconditionFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const status =
		"$metadata" in error && error.$metadata && typeof error.$metadata === "object"
			? (error.$metadata as { httpStatusCode?: unknown }).httpStatusCode
			: undefined;
	return status === 412 || ("name" in error && error.name === "PreconditionFailed");
}

function required(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for notice object storage`);
	return normalized;
}

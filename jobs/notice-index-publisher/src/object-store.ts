import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import type { NoticeArtifactStore, Sha256Ref } from "./types.ts";

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
		async list(prefix) {
			const keys: string[] = [];
			let continuationToken: string | undefined;
			do {
				const response = await client.send(
					new ListObjectsV2Command({
						Bucket: "campus-agent-derived",
						Prefix: prefix,
						...(continuationToken ? { ContinuationToken: continuationToken } : {}),
					}),
				);
				for (const object of response.Contents ?? []) {
					if (object.Key) keys.push(object.Key);
				}
				continuationToken = response.IsTruncated
					? response.NextContinuationToken
					: undefined;
			} while (continuationToken);
			return keys;
		},
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
		async writeImmutableFile(key, input) {
			const file = await stat(input.path);
			if (file.size !== input.byteSize) {
				throw new Error(`notice artifact file size changed before upload: ${input.path}`);
			}
			try {
				await client.send(
					new PutObjectCommand({
						Body: createReadStream(input.path),
						Bucket: "campus-agent-derived",
						ContentLength: input.byteSize,
						ContentType: key.endsWith(".ndjson")
							? "application/x-ndjson"
							: "application/json",
						IfNoneMatch: "*",
						Key: key,
					}),
				);
			} catch (error) {
				if (!isPreconditionFailure(error)) throw error;
				await verifyExistingObject(key, input);
			}
		},
	};

	async function verifyExistingObject(
		key: string,
		input: { byteSize: number; path: string; sha256: Sha256Ref },
	): Promise<void> {
		const response = await client.send(
			new GetObjectCommand({ Bucket: "campus-agent-derived", Key: key }),
		);
		if (!response.Body) throw new Error(`notice artifact body is missing: ${key}`);
		const digest = createHash("sha256");
		let byteSize = 0;
		for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
			byteSize += chunk.byteLength;
			digest.update(chunk);
		}
		const actualSha256 = `sha256:${digest.digest("hex")}` as Sha256Ref;
		if (byteSize !== input.byteSize || actualSha256 !== input.sha256) {
			throw new Error(`immutable notice artifact conflicts with existing content: ${key}`);
		}
	}
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

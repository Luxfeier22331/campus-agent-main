import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
	GetObjectCommand,
	HeadObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
    ListObjectVersionsCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import type { NoticeArtifactStore, Sha256Ref } from "./types.ts";

export interface NoticeObjectStoreEnv {
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_BUCKET_DERIVED?: string;
}

export function createNoticeS3ArtifactStore(
	env: NoticeObjectStoreEnv = process.env,
	options: { signal?: AbortSignal; producerRunId?: string } = {},
): NoticeArtifactStore & { close(): void; inspect(key: string): Promise<{ runId: string | null; modifiedAt: Date | null }>; remove(key: string): Promise<void> } {
	const bucket = env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-agent-derived";
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
	const send: typeof client.send = ((command: any) => { options.signal?.throwIfAborted(); return client.send(command, options.signal ? { abortSignal: options.signal } : {}); }) as typeof client.send;
	const read = async (key: string): Promise<Uint8Array> => {
		const response = await send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
		);
		if (!response.Body) throw new Error(`notice artifact body is missing: ${key}`);
		return response.Body.transformToByteArray();
	};
	return {
		close: () => client.destroy(),
		async inspect(key) {
            try {
                const result = await send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                return { runId: result.Metadata?.["campus-rag-producer-run"] ?? null, modifiedAt: result.LastModified ?? null };
            } catch (error) {
                if (error instanceof Error && ["NotFound", "NoSuchKey"].includes(error.name)) {
                    return { runId: null, modifiedAt: null };
                }
                throw error;
            }
		},
		async remove(key) {
            if (!/^notices\/rag\/(?:chunk-runs|embedding-data|embedding-sets)\/sha256\/[a-f0-9]{64}\/[a-z.-]+$/u.test(key)) {
                throw new Error("Automatic cleanup only removes Notice RAG artifact keys");
            }
            const versions: string[] = [];
            let keyMarker: string | undefined;
            let versionIdMarker: string | undefined;
            do {
                const page = await send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }));
                for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
                    if (entry.Key === key && entry.VersionId) versions.push(entry.VersionId);
                }
                keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
                versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
            } while (keyMarker);
            for (const versionId of versions) {
                await send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
            }
            const remaining = await send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
            if ([...(remaining.Versions ?? []), ...(remaining.DeleteMarkers ?? [])].some((entry) => entry.Key === key)) {
                throw new Error(`Notice artifact versions remain after cleanup: ${key}`);
            }
        },
		read,
		async list(prefix) {
			const keys: string[] = [];
			let continuationToken: string | undefined;
			do {
				const response = await send(
					new ListObjectsV2Command({
						Bucket: bucket,
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
				await send(
					new PutObjectCommand({
						Body: body,
						Bucket: bucket,
						ContentType: key.endsWith(".ndjson")
							? "application/x-ndjson"
							: "application/json",
						IfNoneMatch: "*",
						...(options.producerRunId && !key.includes("/embedding-cache/") ? { Metadata: { "campus-rag-producer-run": options.producerRunId } } : {}),
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
				await send(
					new PutObjectCommand({
						Body: createReadStream(input.path),
						Bucket: bucket,
						ContentLength: input.byteSize,
						ContentType: key.endsWith(".ndjson")
							? "application/x-ndjson"
							: "application/json",
						IfNoneMatch: "*",
						...(options.producerRunId && !key.includes("/embedding-cache/") ? { Metadata: { "campus-rag-producer-run": options.producerRunId } } : {}),
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
		const response = await send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
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

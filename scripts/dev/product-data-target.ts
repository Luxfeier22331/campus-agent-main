import { createHash } from "node:crypto";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { WritableObjectStore } from "../../jobs/campus-rag-index-publisher/src/types.ts";

export function createProductTarget(bucket: string, signal?: AbortSignal) {
	const client = new S3Client({
		endpoint: "http://127.0.0.1:9000",
		forcePathStyle: true,
		region: "us-east-1",
		maxAttempts: 1,
		credentials: { accessKeyId: "rustfsadmin", secretAccessKey: "rustfsadmin" },
	});
	const stats = { writtenObjects: 0, writtenBytes: 0, reusedObjects: 0, readBytes: 0 };
	const confirmed = new Map<string, string>();
	let beforeCreate: (key: string) => void = () => {
		// The hook is only active when the caller tracks created objects.
	};
	const options = () => ({
		abortSignal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
			: AbortSignal.timeout(30_000),
	});
	const read = async (key: string) => {
		const response = await client.send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
			options(),
		);
		if (!response.Body) {
			throw new Error(`Empty local object: ${key}`);
		}
		const bytes = await response.Body.transformToByteArray();
		stats.readBytes += bytes.length;
		return bytes;
	};
	const store: WritableObjectStore = {
		read,
		async readIfExists(key) {
			try {
				return await read(key);
			} catch (error) {
				if (status(error) === 404) {
					return;
				}
				throw error;
			}
		},
		async writeImmutable(key, body, contentType) {
			signal?.throwIfAborted();
			const hash = createHash("sha256").update(body).digest("hex");
			if (confirmed.has(key)) {
				if (confirmed.get(key) !== hash) {
					throw new Error(`Conflicting staged object ${key}`);
				}
				return "existing";
			}
			let exists = true;
			try {
				const head = await client.send(
					new HeadObjectCommand({ Bucket: bucket, Key: key }),
					options(),
				);
				if (head.ContentLength !== body.length) {
					throw new Error(`Local object size conflict: ${key}`);
				}
				if (head.Metadata?.sha256) {
					if (head.Metadata.sha256 !== hash) {
						throw new Error(`Local object checksum conflict: ${key}`);
					}
				} else if (!Buffer.from(await read(key)).equals(Buffer.from(body))) {
					throw new Error(`Local object content conflict: ${key}`);
				}
			} catch (error) {
				if (status(error) !== 404) {
					throw error;
				}
				exists = false;
			}
			if (exists) {
				stats.reusedObjects += 1;
				confirmed.set(key, hash);
				return "existing";
			}
			beforeCreate(key);
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: contentType ?? "application/json",
					IfNoneMatch: "*",
					Metadata: { sha256: hash },
				}),
				options(),
			);
			confirmed.set(key, hash);
			stats.writtenObjects += 1;
			stats.writtenBytes += body.length;
			return "created";
		},
	};
	return {
		store,
		stats,
		onCreate(callback: (key: string) => void) {
			beforeCreate = callback;
		},
		async remove(key: string) {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
				abortSignal: AbortSignal.timeout(30_000),
			});
		},
		close() {
			client.destroy();
		},
	};
}

function status(error: unknown): number | undefined {
	return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

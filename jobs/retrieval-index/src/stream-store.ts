import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	ListObjectsV2Command,
	ListObjectVersionsCommand,
	DeleteObjectCommand,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { canonical, digest, type StreamStore } from "./workspace.ts";
import type { ObjectReference, Sha256Ref } from "./types.ts";

const UPLOAD_PART_BYTES = 16 * 1024 * 1024;

/** One part in flight; object size never determines the upload buffer size. */
async function multipart(client: S3Client, Bucket: string, Key: string, rows: Iterable<Buffer>) {
	const { UploadId } = await client.send(
		new CreateMultipartUploadCommand({ Bucket, Key, ContentType: "application/x-ndjson" }),
	);
	if (!UploadId) throw new Error("object store did not return an upload ID");
	try {
		const Parts: { ETag: string; PartNumber: number }[] = [];
		const buffer = Buffer.allocUnsafe(UPLOAD_PART_BYTES);
		let used = 0;
		const upload = async () => {
			if (Parts.length === 10_000) throw new Error("artifact exceeds multipart part limit");
			const PartNumber = Parts.length + 1;
			const { ETag } = await client.send(
				new UploadPartCommand({
					Bucket,
					Key,
					UploadId,
					PartNumber,
					Body: buffer.subarray(0, used),
					ContentLength: used,
				}),
			);
			if (!ETag) throw new Error("object store did not acknowledge uploaded part");
			Parts.push({ PartNumber, ETag });
			used = 0;
		};
		for (const row of rows) {
			for (let offset = 0; offset < row.length; ) {
				const copied = row.copy(buffer, used, offset, offset + UPLOAD_PART_BYTES - used);
				used += copied;
				offset += copied;
				if (used === UPLOAD_PART_BYTES) await upload();
			}
		}
		if (used) await upload();
		await client.send(
			new CompleteMultipartUploadCommand({
				Bucket,
				Key,
				UploadId,
				MultipartUpload: { Parts },
				IfNoneMatch: "*",
			}),
		);
	} catch (error) {
		await client
			.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }))
			.catch(() => undefined);
		throw error;
	}
}

export interface ArtifactStore extends StreamStore {
	write(key: string, bytes: Uint8Array): Promise<void>;
	writeRecords(
		prefix: string,
		file: string,
		rows: () => Iterable<unknown>,
	): Promise<ObjectReference>;
	list(prefix: string): AsyncIterable<string>;
	remove(key: string): Promise<void>;
	close(): void;
}
export function createArtifactStore(
	env: NodeJS.ProcessEnv = process.env,
	readOnly = false,
): ArtifactStore {
	const required = (name: string) => {
		const v = env[name]?.trim();
		if (!v) throw new Error(`${name} is required`);
		return v;
	};
	const client = new S3Client({
		endpoint: required("OBJECT_STORE_ENDPOINT"),
		forcePathStyle: true,
		region: "us-east-1",
		requestChecksumCalculation: "WHEN_REQUIRED",
		credentials: {
			accessKeyId: required(
				readOnly ? "OBJECT_STORE_DERIVED_READ_ACCESS_KEY" : "OBJECT_STORE_DERIVED_ACCESS_KEY",
			),
			secretAccessKey: required(
				readOnly ? "OBJECT_STORE_DERIVED_READ_SECRET_KEY" : "OBJECT_STORE_DERIVED_SECRET_KEY",
			),
		},
	});
	const Bucket = env.OBJECT_STORE_BUCKET_DERIVED || "campus-agent-derived";
	async function* stream(Key: string) {
		const r = await client.send(new GetObjectCommand({ Bucket, Key }));
		if (!r.Body) throw new Error(`missing ${Key}`);
		yield* r.Body as AsyncIterable<Uint8Array>;
	}
	async function verifyExisting(Key: string, ContentLength: number) {
		const expected = Key.match(/\/sha256\/([a-f0-9]{64})\//)?.[1];
		const hash = createHash("sha256");
		let size = 0;
		for await (const b of stream(Key)) {
			hash.update(b);
			size += b.byteLength;
		}
		if (hash.digest("hex") !== expected || size !== ContentLength)
			throw new Error(`immutable conflict: ${Key}`);
	}
	const put = async (Key: string, Body: Uint8Array | Readable, ContentLength: number) => {
		try {
			await client.send(
				new PutObjectCommand({
					Bucket,
					Key,
					Body,
					ContentLength,
					IfNoneMatch: "*",
					ContentType: Key.endsWith(".ndjson") ? "application/x-ndjson" : "application/json",
				}),
			);
		} catch (e) {
			if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
				throw e;
			// Immutable keys are content digests. Verify existing bytes without buffering them.
			await verifyExisting(Key, ContentLength);
		}
	};
	return {
		stream,
		async read(key) {
			const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
			if (!r.Body) throw new Error(`missing ${key}`);
			return r.Body.transformToByteArray();
		},
		async write(key, bytes) {
			await put(key, bytes, bytes.byteLength);
		},
		async writeRecords(prefix, file, rows) {
			const hash = createHash("sha256");
			let byteSize = 0;
			for (const row of rows()) {
				const line = canonical(row) + "\n";
				hash.update(line);
				byteSize += Buffer.byteLength(line);
			}
			if (!byteSize) throw new Error("artifact has no records");
			const sha256 = `sha256:${hash.digest("hex")}` as Sha256Ref;
			const key = `${prefix}/sha256/${sha256.slice(7)}/${file}`;
			function* bytes() {
				for (const row of rows()) yield Buffer.from(canonical(row) + "\n");
			}
			if (byteSize <= UPLOAD_PART_BYTES) await put(key, Readable.from(bytes()), byteSize);
			else {
				try {
					await multipart(client, Bucket, key, bytes());
				} catch (error) {
					if (
						(error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412
					)
						throw error;
					await verifyExisting(key, byteSize);
				}
			}
			return { key, byteSize, sha256 };
		},
		async *list(Prefix) {
			let ContinuationToken: string | undefined;
			do {
				const r = await client.send(
					new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
				);
				for (const o of r.Contents ?? []) if (o.Key) yield o.Key;
				ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
			} while (ContinuationToken);
		},
		async remove(Key) {
			if (
				!/^(campus-docs|notices)\/rag\/(chunk-data|chunk-sets|chunk-runs|embedding-data|embedding-sets)\/sha256\/[a-f0-9]{64}\/[a-z.-]+$/.test(
					Key,
				)
			)
				throw new Error(`unsupported cleanup key: ${Key}`);
			// Delete one bounded page at a time, including historical object versions.
			for (;;) {
				const r = await client.send(
					new ListObjectVersionsCommand({ Bucket, Prefix: Key, MaxKeys: 100 }),
				);
				const entries = [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])].filter(
					(x) => x.Key === Key,
				);
				if (!entries.length) break;
				for (const e of entries)
					await client.send(new DeleteObjectCommand({ Bucket, Key, VersionId: e.VersionId }));
			}
		},
		close() {
			client.destroy();
		},
	};
}
export async function writeManifest(store: ArtifactStore, prefix: string, value: unknown) {
	const bytes = Buffer.from(
		(prefix.startsWith("campus-docs/")
			? JSON.stringify(JSON.parse(canonical(value)), null, 2)
			: canonical(value)) + "\n",
	);
	const id = digest(bytes);
	await store.write(`${prefix}/sha256/${id.slice(7)}/manifest.json`, bytes);
	return id;
}

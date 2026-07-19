import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import { sha256 } from "./release.ts";
import type { DocsObjectStore, ObjectRef } from "./types.ts";

export function createDocsObjectStore(env: NodeJS.ProcessEnv = process.env): DocsObjectStore {
	const bucket = required(env, "OBJECT_STORE_BUCKET_DERIVED");
	const client = new S3Client({
		credentials: {
			accessKeyId: required(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
			secretAccessKey: required(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
		},
		endpoint: required(env, "OBJECT_STORE_ENDPOINT"),
		forcePathStyle: true,
		region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
	});

	async function readByKey(key: string): Promise<Uint8Array | undefined> {
		try {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
			if (!response.Body) throw new Error(`empty object body: ${key}`);
			return response.Body.transformToByteArray();
		} catch (error) {
			if (isMissing(error)) return undefined;
			throw error;
		}
	}

	return {
		async createOrVerify(input) {
			const expected: ObjectRef = {
				byteSize: input.body.byteLength,
				key: input.key,
				sha256: sha256(input.body),
			};
			try {
				await client.send(
					new PutObjectCommand({
						Body: input.body,
						Bucket: bucket,
						ContentType: input.contentType,
						IfNoneMatch: "*",
						Key: input.key,
					}),
				);
				return expected;
			} catch (error) {
				if (!isPreconditionFailure(error)) throw error;
				const existing = await readByKey(input.key);
				if (!existing) throw new Error(`object disappeared after create conflict: ${input.key}`);
				assertBytes(existing, expected);
				return expected;
			}
		},
		async read(input) {
			const bytes = await readByKey(input.key);
			if (!bytes) throw new Error(`missing object: ${input.key}`);
			assertBytes(bytes, input);
			return bytes;
		},
		readByKey,
	};
}

export function assertBytes(bytes: Uint8Array, ref: ObjectRef): void {
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`object byte size mismatch for ${ref.key}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new Error(`object SHA-256 mismatch for ${ref.key}`);
	}
}

function required(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) throw new Error(`${key} is required for docs publication`);
	return value;
}

function isMissing(error: unknown): boolean {
	return status(error) === 404 || code(error) === "NoSuchKey" || code(error) === "NotFound";
}

function isPreconditionFailure(error: unknown): boolean {
	return status(error) === 412 || code(error) === "PreconditionFailed";
}

function code(error: unknown): unknown {
	return error && typeof error === "object" && "name" in error ? error.name : undefined;
}

function status(error: unknown): unknown {
	if (!(error && typeof error === "object" && "$metadata" in error)) return undefined;
	const metadata = error.$metadata;
	return metadata && typeof metadata === "object" && "httpStatusCode" in metadata
		? metadata.httpStatusCode
		: undefined;
}

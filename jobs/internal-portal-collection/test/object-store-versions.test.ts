import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInternalPortalCollectionObjectStoreFromEnv } from "../src/object-store.js";

const key = "internal_portal/notices/_state.json";
const baseEnv = {
	OBJECT_STORE_ENDPOINT: "http://localhost:9000",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "test",
	OBJECT_STORE_SOURCE_SECRET_KEY: "test",
};
afterEach(() => vi.restoreAllMocks());

describe.each([
	{ name: "cluster bucket", bucket: "campus-agent-source", sourceBucket: "campus-agent-source" },
	{
		name: "worktree override",
		bucket: "campus-agent-source-wt-1-deadbeef",
		sourceBucket: "campus-agent-source-wt-1-deadbeef",
	},
])("state object storage ($name)", ({ bucket, sourceBucket }) => {
	const env = { ...baseEnv, OBJECT_STORE_BUCKET_SOURCE: sourceBucket };

	it("reads the state from the selected source bucket", async () => {
		const body = Buffer.from("{}");
		vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
			expect(command).toBeInstanceOf(GetObjectCommand);
			expect(command.input).toMatchObject({ Bucket: bucket, Key: key });
			return { Body: { transformToByteArray: async () => body } } as never;
		});
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		expect(store.sourceBucket).toBe(bucket);
		expect(await store.getObjectIfExists({ bucket: store.sourceBucket, key })).toEqual(body);
		await store.close?.();
	});

	it("checks existence with HEAD and forwards cancellation", async () => {
		const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		const abortSignal = new AbortController().signal;
		expect(await store.hasObject({ bucket, key, abortSignal })).toBe(true);
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
		expect(send.mock.calls[0]?.[0].input).toEqual({ Bucket: bucket, Key: key });
		expect(send).toHaveBeenCalledWith(expect.any(HeadObjectCommand), { abortSignal });
		await store.close?.();
	});

	it.each([404, 403, 503])("only treats HTTP %s as absent when it is 404", async (status) => {
		const error = Object.assign(new Error("storage response"), { $metadata: { httpStatusCode: status } });
		vi.spyOn(S3Client.prototype, "send").mockRejectedValue(error);
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		const result = store.hasObject({ bucket, key });
		if (status === 404) await expect(result).resolves.toBe(false);
		else await expect(result).rejects.toBe(error);
		await store.close?.();
	});

	it("overwrites mutable objects in the selected source bucket", async () => {
		const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		await store.putObject({
			bucket,
			key,
			body: Buffer.from("{}"),
			contentType: "application/json",
		});
		const command = send.mock.calls[0]?.[0] as PutObjectCommand;
		expect(command).toBeInstanceOf(PutObjectCommand);
		expect(command.input).toMatchObject({ Bucket: bucket, Key: key, ContentType: "application/json" });
		expect(command.input.IfNoneMatch).toBeUndefined();
		await store.close?.();
	});
});

it.each([undefined, "", "   "])("requires an explicit source bucket (%s)", (value) => {
	expect(() => createInternalPortalCollectionObjectStoreFromEnv({
		...baseEnv, OBJECT_STORE_BUCKET_SOURCE: value,
	})).toThrow("OBJECT_STORE_BUCKET_SOURCE is required");
});

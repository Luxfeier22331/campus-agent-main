import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectVersionsCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInternalPortalCollectionObjectStoreFromEnv } from "../src/object-store.js";

const bucket = "campus-agent-source";
const key = "internal_portal/notices/_state.json";
const env = {
	OBJECT_STORE_ENDPOINT: "http://localhost:9000",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "test",
	OBJECT_STORE_SOURCE_SECRET_KEY: "test",
	OBJECT_STORE_BUCKET_SOURCE: bucket,
};
afterEach(() => vi.restoreAllMocks());

it("reads and writes the source bucket supplied by the local environment", async () => {
	const localBucket = "campus-agent-source-wt-test";
	const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
		if (command instanceof GetObjectCommand) {
			expect(command.input.Bucket).toBe(localBucket);
			return { Body: { transformToByteArray: async () => Buffer.from("{}") } } as never;
		}
		expect(command).toBeInstanceOf(PutObjectCommand);
		expect((command as PutObjectCommand).input.Bucket).toBe(localBucket);
		return {} as never;
	});
	const store = createInternalPortalCollectionObjectStoreFromEnv({
		...env,
		OBJECT_STORE_BUCKET_SOURCE: ` ${localBucket} `,
	});
	try {
		await store.putObject({ bucket: store.sourceBucket, key, body: Buffer.from("{}"), contentType: "application/json" });
		expect(await store.getObject({ bucket: store.sourceBucket, key })).toEqual(Buffer.from("{}"));
		expect(send).toHaveBeenCalledTimes(2);
	} finally {
		await store.close?.();
	}
});

it.each([undefined, "", "   "])("requires an explicit source bucket (%s)", (value) => {
	expect(() => createInternalPortalCollectionObjectStoreFromEnv({
		...env, OBJECT_STORE_BUCKET_SOURCE: value,
	})).toThrow("OBJECT_STORE_BUCKET_SOURCE is required");
});

describe("state version pruning", () => {
	it("returns the version created by the write", async () => {
		vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
			expect(command).toBeInstanceOf(PutObjectCommand);
			return { VersionId: "new" } as never;
		});
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		expect(
			await store.putObject({
				bucket,
				key,
				body: Buffer.from("{}"),
				contentType: "application/json",
			}),
		).toMatchObject({ versionId: "new" });
		await store.close?.();
	});

	it("lists all pages before deleting only exact-key obsolete versions and markers", async () => {
		const commands: unknown[] = [];
		vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
			commands.push(command);
			if (command instanceof ListObjectVersionsCommand) {
				if (!command.input.KeyMarker) {
					return {
						Versions: [
							{ Key: key, VersionId: "new", IsLatest: true },
							{ Key: key, VersionId: "old" },
						],
						IsTruncated: true,
						NextKeyMarker: key,
						NextVersionIdMarker: "old",
					} as never;
				}
				expect(command.input.VersionIdMarker).toBe("old");
				expect(commands.every((entry) => entry instanceof ListObjectVersionsCommand)).toBe(true);
				return {
					Versions: [{ Key: `${key}.other`, VersionId: "unrelated" }],
					DeleteMarkers: [{ Key: key, VersionId: "marker" }],
				} as never;
			}
			expect(command).toBeInstanceOf(DeleteObjectCommand);
			return {} as never;
		});
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		await store.pruneObjectVersions({ bucket, key, keepVersionId: "new" });
		expect(
			commands
				.filter((command) => command instanceof DeleteObjectCommand)
				.map((command) => (command as DeleteObjectCommand).input),
		).toEqual([
			{ Bucket: bucket, Key: key, VersionId: "old" },
			{ Bucket: bucket, Key: key, VersionId: "marker" },
		]);
		await store.close?.();
	});

	it("does not delete anything after a failed listing", async () => {
		const send = vi
			.spyOn(S3Client.prototype, "send")
			.mockRejectedValue(new Error("access denied"));
		const store = createInternalPortalCollectionObjectStoreFromEnv(env);
		await expect(
			store.pruneObjectVersions({ bucket, key, keepVersionId: "new" }),
		).rejects.toThrow("access denied");
		expect(send.mock.calls.every(([command]) => command instanceof ListObjectVersionsCommand)).toBe(true);
		await store.close?.();
	});
});

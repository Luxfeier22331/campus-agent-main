import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createS3IngestionObjectStore, createS3IngestionObjectStoreFromEnv } from "../src/index.ts";

describe("ingestion-control object store adapter", () => {
	it("uses SDK commands for source-bucket reads and writes", async () => {
		const sentInputs: Record<string, unknown>[] = [];
		const client = {
			async send(command: { input: Record<string, unknown> }): Promise<unknown> {
				sentInputs.push(command.input);
				if (command.input.Key === "runs/capture-release.json") {
					return {
						Body: {
							async transformToByteArray(): Promise<Uint8Array> {
								return new Uint8Array([1, 2, 3]);
							},
						},
					};
				}
				return {};
			},
		};
		const store = createS3IngestionObjectStore({
			bucket: "campus-agent-source",
			client,
		});

		await expect(
			store.getObject({
				bucket: "campus-agent-source",
				key: "runs/capture-release.json",
			}),
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
		const body = Buffer.from("materialized", "utf8");
		await expect(
			store.putObject({
				bucket: "campus-agent-source",
				key: "source-truth/notice-manifest.json",
				body,
				contentType: "application/json",
			}),
		).resolves.toEqual({
			byteSize: body.byteLength,
			contentSha256: createHash("sha256").update(body).digest("hex"),
		});

		expect(sentInputs).toMatchObject([
			{
				Bucket: "campus-agent-source",
				Key: "runs/capture-release.json",
			},
			{
				Bucket: "campus-agent-source",
				Key: "source-truth/notice-manifest.json",
				ContentLength: body.byteLength,
				ContentType: "application/json",
			},
		]);
		expect(sentInputs[1]?.Metadata).toMatchObject({
			"content-sha256": createHash("sha256").update(body).digest("hex"),
		});
	});

	it("fails closed when a task references a different bucket", async () => {
		const store = createS3IngestionObjectStore({
			bucket: "campus-agent-source",
			client: {
				async send(): Promise<unknown> {
					throw new Error("send should not be called");
				},
			},
		});

		await expect(
			store.getObject({
				bucket: "other-bucket",
				key: "runs/capture-release.json",
			}),
		).rejects.toThrow("object bucket mismatch");
	});

	it("builds from complete env and rejects partial object-store env", () => {
		expect(createS3IngestionObjectStoreFromEnv({})).toBeUndefined();
		expect(() =>
			createS3IngestionObjectStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "minio",
			}),
		).toThrow(
			"OBJECT_STORE_ENDPOINT plus OBJECT_STORE_SOURCE_ACCESS_KEY and OBJECT_STORE_SOURCE_SECRET_KEY are required",
		);
		expect(
			createS3IngestionObjectStoreFromEnv({
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
				OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "minio",
				OBJECT_STORE_SOURCE_SECRET_KEY: "minio-secret",
			}),
		).toBeDefined();
	});
});

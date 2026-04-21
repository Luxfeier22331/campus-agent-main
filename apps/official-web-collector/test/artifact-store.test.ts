// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createS3ArtifactStoreFromEnv, S3ArtifactStore } from "../src/artifact-store";

describe("official-web artifact store", () => {
	it("uploads objects to the configured source bucket and returns artifact refs", async () => {
		const client = {
			send: vi.fn().mockResolvedValue({}),
		};
		const store = new S3ArtifactStore({
			bucket: "campus-rag-source",
			client,
		});
		const data = new TextEncoder().encode('{"schemaVersion":"official_web_crawl_run.v1"}');

		const result = await store.putObject({
			objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			data,
			contentType: "application/json",
			recordCount: 1,
		});

		expect(client.send).toHaveBeenCalledTimes(1);
		const command = client.send.mock.calls[0]?.[0];
		expect(command?.input).toMatchObject({
			Bucket: "campus-rag-source",
			Key: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			Body: data,
			ContentType: "application/json",
		});
		expect(result).toEqual({
			objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			contentSha256: createHash("sha256").update(data).digest("hex"),
			byteSize: data.byteLength,
			recordCount: 1,
		});
	});

	it("returns undefined when object-store env is absent", () => {
		expect(createS3ArtifactStoreFromEnv({})).toBeUndefined();
	});

	it("fails closed when object-store env is partially configured", () => {
		expect(() =>
			createS3ArtifactStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_ACCESS_KEY: "minioadmin",
			}),
		).toThrowError(/OBJECT_STORE_ENDPOINT.*credential pair/i);
	});

	it("accepts source-bucket scoped credentials when shared credentials are absent", () => {
		expect(() =>
			createS3ArtifactStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "https://s3.cstcloud.cn",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "source-ak",
				OBJECT_STORE_SOURCE_SECRET_KEY: "source-sk",
				OBJECT_STORE_BUCKET_SOURCE: "campus-rag-source",
			} as never),
		).not.toThrow();
	});
});

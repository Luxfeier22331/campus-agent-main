// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { S3ArtifactStore } from "../src/artifact-store";

describe("official-web artifact store", () => {
	it("uploads objects to the configured source bucket and returns artifact refs", async () => {
		const client = {
			send: vi.fn().mockImplementation((command) =>
				command.constructor.name === "HeadObjectCommand"
					? Promise.resolve({
							ContentLength: data.byteLength,
							Metadata: {
								"content-sha256": createHash("sha256").update(data).digest("hex"),
							},
						})
					: Promise.resolve({}),
			),
		};
		const store = new S3ArtifactStore({
			bucket: "campus-agent-source",
			client,
		});
		const data = new TextEncoder().encode('{"schemaVersion":"official_web_crawl_run.v1"}');

		const result = await store.createOrVerifyObject({
			objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			data,
			contentType: "application/json",
			recordCount: 1,
		});

		expect(client.send).toHaveBeenCalledTimes(2);
		const command = client.send.mock.calls[0]?.[0];
		expect(command?.input).toMatchObject({
			Bucket: "campus-agent-source",
			Key: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			Body: data,
			ContentType: "application/json",
			ContentLength: data.byteLength,
		});
		expect(result).toMatchObject({
			objectKey: "official_web/campus_public/runs/owrun_01JQTEST/crawl-run.json",
			contentSha256: createHash("sha256").update(data).digest("hex"),
			byteSize: data.byteLength,
			recordCount: 1,
		});
	});

	it("leaves object-store upload retry behavior to the configured SDK client", async () => {
		const error = new Error("SlowDownWrite");
		const client = {
			send: vi.fn().mockRejectedValue(error),
		};
		const store = new S3ArtifactStore({
			bucket: "campus-agent-source",
			client,
		});
		const data = new TextEncoder().encode(
			'{"schemaVersion":"official_web_source_truth_bundle.v2"}',
		);

		await expect(
			store.createOrVerifyObject({
				objectKey: "official_web/campus_public/runs/owrun_01JQTEST/source-truth-bundle.json",
				data,
				contentType: "application/json",
				recordCount: 1,
			}),
		).rejects.toBe(error);

		expect(client.send).toHaveBeenCalledTimes(1);
	});
});

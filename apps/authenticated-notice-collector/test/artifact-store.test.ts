// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	createAuthenticatedNoticeArtifactStore,
	createAuthenticatedNoticeArtifactStoreFromEnv,
} from "../src/artifact-store.js";

describe("authenticated-notice artifact store env", () => {
	it("returns undefined when object-store env is absent", () => {
		expect(createAuthenticatedNoticeArtifactStoreFromEnv({})).toBeUndefined();
	});

	it("fails closed when object-store env is partially configured", () => {
		expect(() =>
			createAuthenticatedNoticeArtifactStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "https://s3.cstcloud.cn",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "source-ak",
			} as never),
		).toThrowError(
			/OBJECT_STORE_ENDPOINT.*OBJECT_STORE_SOURCE_ACCESS_KEY.*OBJECT_STORE_SOURCE_SECRET_KEY/i,
		);
	});

	it("accepts source-bucket scoped credentials when shared credentials are absent", () => {
		expect(() =>
			createAuthenticatedNoticeArtifactStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "https://s3.cstcloud.cn",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "source-ak",
				OBJECT_STORE_SOURCE_SECRET_KEY: "source-sk",
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			} as never),
		).not.toThrow();
	});

	it("verifies a stored object with head metadata after upload", async () => {
		const sentCommandNames: string[] = [];
		const store = createAuthenticatedNoticeArtifactStore({
			bucket: "campus-agent-source",
			client: {
				async send(command) {
					sentCommandNames.push(command.constructor.name);
					if (command.constructor.name === "PutObjectCommand") {
						return { ETag: '"etag"' };
					}
					return {
						ContentLength: 5,
						ETag: '"etag"',
						Metadata: {
							"content-sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
						},
					};
				},
			},
		});

		const ref = await store.putObject({
			objectKey: "authenticated_notice_portal/runs/run/notices-bundle.json",
			data: Buffer.from("hello"),
			contentType: "application/json",
		});

		expect(sentCommandNames).toEqual(["PutObjectCommand", "HeadObjectCommand"]);
		expect(ref).toMatchObject({
			bucket: "campus-agent-source",
			byteSize: 5,
			contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			objectKey: "authenticated_notice_portal/runs/run/notices-bundle.json",
		});
	});

	it("fails closed when post-upload head metadata does not match payload size", async () => {
		const store = createAuthenticatedNoticeArtifactStore({
			bucket: "campus-agent-source",
			client: {
				async send(command) {
					if (command.constructor.name === "PutObjectCommand") {
						return { ETag: '"etag"' };
					}
					return {
						ContentLength: 4,
						ETag: '"etag"',
						Metadata: {},
					};
				},
			},
		});

		await expect(
			store.putObject({
				objectKey: "authenticated_notice_portal/runs/run/notices-bundle.json",
				data: Buffer.from("hello"),
				contentType: "application/json",
			}),
		).rejects.toThrow(/size mismatch/i);
	});
});

// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createAuthenticatedNoticeArtifactStore } from "../src/artifact-store.js";

describe("authenticated-notice artifact store", () => {
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

		const ref = await store.createOrVerifyObject({
			objectKey: "internal_portal/runs/run/notices-bundle.json",
			data: Buffer.from("hello"),
			contentType: "application/json",
		});

		expect(sentCommandNames).toEqual(["PutObjectCommand", "HeadObjectCommand"]);
		expect(ref).toMatchObject({
			bucket: "campus-agent-source",
			byteSize: 5,
			contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			objectKey: "internal_portal/runs/run/notices-bundle.json",
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
			store.createOrVerifyObject({
				objectKey: "internal_portal/runs/run/notices-bundle.json",
				data: Buffer.from("hello"),
				contentType: "application/json",
			}),
		).rejects.toThrow(/artifact identity collision/i);
	});
});

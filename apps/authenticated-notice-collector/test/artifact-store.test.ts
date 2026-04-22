// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createAuthenticatedNoticeArtifactStoreFromEnv } from "../src/artifact-store";

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
		).toThrowError(/OBJECT_STORE_ENDPOINT.*credential pair/i);
	});

	it("accepts source-bucket scoped credentials when shared credentials are absent", () => {
		expect(() =>
			createAuthenticatedNoticeArtifactStoreFromEnv({
				OBJECT_STORE_ENDPOINT: "https://s3.cstcloud.cn",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "source-ak",
				OBJECT_STORE_SOURCE_SECRET_KEY: "source-sk",
				OBJECT_STORE_BUCKET_SOURCE: "campus-rag-source",
			} as never),
		).not.toThrow();
	});
});

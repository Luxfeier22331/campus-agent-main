import { describe, expect, it } from "vitest";

import { omitObjectStoreEnvironment } from "../scripts/build-process-env.ts";

describe("Campus Web child process environment", () => {
	it("does not pass object-store configuration to Vite", () => {
		const sourceEnvironment = {
			APP_API_BASE_URL: "http://127.0.0.1:27031",
			OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "access",
			OBJECT_STORE_DERIVED_SECRET_KEY: "secret",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		};

		expect(omitObjectStoreEnvironment(sourceEnvironment)).toEqual({
			APP_API_BASE_URL: "http://127.0.0.1:27031",
		});
		expect(sourceEnvironment.OBJECT_STORE_ENDPOINT).toBe("http://127.0.0.1:9000");
	});
});

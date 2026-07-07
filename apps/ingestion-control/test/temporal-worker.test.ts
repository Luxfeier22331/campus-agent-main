import { describe, expect, it } from "vitest";
import { requireTemporalWorkerObjectStore } from "../src/temporal-worker.ts";

describe("ingestion temporal worker startup", () => {
	it("fails closed when source object store config is missing", () => {
		expect(() => requireTemporalWorkerObjectStore({})).toThrow(
			"ingestion Temporal worker requires source object store configuration",
		);
	});

	it("fails closed when source object store config is partial", () => {
		expect(() =>
			requireTemporalWorkerObjectStore({
				OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
				OBJECT_STORE_SOURCE_ACCESS_KEY: "minio",
			}),
		).toThrow("OBJECT_STORE_ENDPOINT plus OBJECT_STORE_SOURCE_ACCESS_KEY");
	});
});

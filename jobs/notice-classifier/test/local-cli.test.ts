import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	assertLocalNoticeClassifierObjectStoreEnvironment,
	LOCAL_NOTICE_CLASSIFIER_PROVIDER_SNAPSHOT_URL,
	loadLocalNoticeClassifierEnvironment,
} from "../src/local-cli.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("local notice classifier entrypoint", () => {
	it("uses the loopback snapshot endpoint by default", () => {
		expect(LOCAL_NOTICE_CLASSIFIER_PROVIDER_SNAPSHOT_URL).toBe(
			"http://127.0.0.1:18002/internal/provider-snapshots/notice-classifier",
		);
	});

	it("requires the complete local object store contract", () => {
		const environment: NodeJS.ProcessEnv = {
			OBJECT_STORE_BUCKET_DERIVED: "derived",
			OBJECT_STORE_BUCKET_SOURCE: "source",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
			OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
			OBJECT_STORE_ENDPOINT: "http://object-store.test",
			OBJECT_STORE_REGION: "local",
			OBJECT_STORE_SOURCE_ACCESS_KEY: "source-access",
			OBJECT_STORE_SOURCE_SECRET_KEY: "source-secret",
		};

		expect(() =>
			assertLocalNoticeClassifierObjectStoreEnvironment({
				...environment,
				OBJECT_STORE_REGION: undefined,
			}),
		).toThrow("OBJECT_STORE_REGION is required");
		expect(() => assertLocalNoticeClassifierObjectStoreEnvironment(environment)).not.toThrow();
	});

	it("loads only missing values from the managed environment file", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "campus-agent-notice-local-env-"));
		temporaryDirectories.push(directory);
		const environmentPath = resolve(directory, ".env.local");
		const key = "NOTICE_CLASSIFIER_LOCAL_TEST_VALUE";
		const previous = process.env[key];
		try {
			delete process.env[key];
			writeFileSync(environmentPath, `${key}=from-file\n`);
			loadLocalNoticeClassifierEnvironment(environmentPath);
			expect(process.env[key]).toBe("from-file");
			process.env[key] = "from-process";
			loadLocalNoticeClassifierEnvironment(environmentPath);
			expect(process.env[key]).toBe("from-process");
		} finally {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		}
	});
});

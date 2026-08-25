import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
	loadLocalNoticeClassifierEnvironment,
} from "../src/local-cli.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("local notice classifier entrypoint", () => {
	it("uses the loopback Model Config service by default", () => {
		expect(LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL).toBe("http://127.0.0.1:18003");
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

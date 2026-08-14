import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	loadCampusWebBuildEnvironment,
	omitObjectStoreEnvironment,
} from "../scripts/build-process-env.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("Campus Web child process environment", () => {
	it("loads local build values with command and process overrides", () => {
		const repoRoot = createRepositoryShape();
		const appRoot = resolve(repoRoot, "apps/campus-web");
		writeFileSync(
			resolve(appRoot, ".dev.vars.local"),
			[
				"APP_API_BASE_URL=http://127.0.0.1:27031",
				"OBJECT_STORE_ENDPOINT=http://127.0.0.1:9000",
				"OBJECT_STORE_DERIVED_READ_ACCESS_KEY=local-access",
				"OBJECT_STORE_DERIVED_READ_SECRET_KEY=local-secret",
			].join("\n"),
		);
		writeFileSync(
			resolve(repoRoot, "env/commands/campus-docs-source.env"),
			[
				"OBJECT_STORE_ENDPOINT=https://command.example.test",
				"OBJECT_STORE_DERIVED_READ_ACCESS_KEY=command-access",
			].join("\n"),
		);

		const environment = loadCampusWebBuildEnvironment({
			appRoot,
			processEnvironment: {
				OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "process-access",
				OBJECT_STORE_DERIVED_READ_SECRET_KEY: "process-secret",
			},
			repoRoot,
		});

		expect(environment).toEqual({
			APP_API_BASE_URL: "http://127.0.0.1:27031",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "process-access",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "process-secret",
			OBJECT_STORE_ENDPOINT: "https://command.example.test",
		});
	});

	it("uses the process environment when local build files are absent", () => {
		const repoRoot = createRepositoryShape();
		const processEnvironment = {
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "ci-access",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "ci-secret",
			OBJECT_STORE_ENDPOINT: "https://objects.example.test",
		};

		expect(
			loadCampusWebBuildEnvironment({
				appRoot: resolve(repoRoot, "apps/campus-web"),
				processEnvironment,
				repoRoot,
			}),
		).toEqual(processEnvironment);
	});

	it("does not pass object-store configuration to Vite", () => {
		const sourceEnvironment = {
			APP_API_BASE_URL: "http://127.0.0.1:27031",
			OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "access",
			OBJECT_STORE_DERIVED_SECRET_KEY: "secret",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "read-access",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "read-secret",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		};

		expect(omitObjectStoreEnvironment(sourceEnvironment)).toEqual({
			APP_API_BASE_URL: "http://127.0.0.1:27031",
		});
		expect(sourceEnvironment.OBJECT_STORE_ENDPOINT).toBe("http://127.0.0.1:9000");
	});
});

function createRepositoryShape(): string {
	const repoRoot = mkdtempSync(resolve(tmpdir(), "campus-web-build-env-"));
	temporaryDirectories.push(repoRoot);
	mkdirSync(resolve(repoRoot, "apps/campus-web"), { recursive: true });
	mkdirSync(resolve(repoRoot, "env/commands"), { recursive: true });
	return repoRoot;
}

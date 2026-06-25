import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	loadPrepareDocsReaderBuildEnvFiles,
	parsePrepareDocsReaderBuildArgs,
	resolvePrepareDocsReaderBuildEnv,
} from "../../../scripts/prepare-campus-docs-reader-build.mjs";

let tempDir: string | null = null;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
});

describe("campus docs reader build prepare script", () => {
	it("resolves the default public docs sync manifest output path", () => {
		expect(parsePrepareDocsReaderBuildArgs([])).toEqual({
			publicDocsSyncManifestPath: "var/public-docs-sync-manifest.json",
			readModelManifestPath: undefined,
		});
	});

	it("accepts an explicit docs read-model manifest input", () => {
		expect(
			parsePrepareDocsReaderBuildArgs(["--read-model-manifest", "var/docs-read-model.json"]),
		).toEqual({
			publicDocsSyncManifestPath: "var/public-docs-sync-manifest.json",
			readModelManifestPath: "var/docs-read-model.json",
		});
	});

	it("fails closed when required local publish env is incomplete", () => {
		expect(() =>
			resolvePrepareDocsReaderBuildEnv({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://localhost/app",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
			}),
		).toThrow(
			"Missing required docs reader build env: OBJECT_STORE_BUCKET_DERIVED, object-store credentials",
		);
	});

	it("accepts derived-only object store credentials for reader asset checks", () => {
		expect(
			resolvePrepareDocsReaderBuildEnv({
				APP_API_OPERATOR_DATABASE_URL: "postgresql://localhost/app",
				OBJECT_STORE_ENDPOINT: "http://localhost:9000",
				OBJECT_STORE_BUCKET_DERIVED: "campus-rag-derived",
				OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
				OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
			}),
		).toMatchObject({
			APP_API_OPERATOR_DATABASE_URL: "postgresql://localhost/app",
			OBJECT_STORE_BUCKET_DERIVED: "campus-rag-derived",
			OBJECT_STORE_CREDENTIAL_MODE: "derived",
			OBJECT_STORE_ENDPOINT: "http://localhost:9000",
		});
	});

	it("keeps shell env highest while command env overrides root and app-local files", () => {
		tempDir = mkdtempSync(join(tmpdir(), "campus-docs-reader-env-"));
		const rootEnv = join(tempDir, "root.env");
		const appEnv = join(tempDir, "app.env");
		const commandEnv = join(tempDir, "command.env");
		writeFileSync(
			rootEnv,
			[
				"APP_API_OPERATOR_DATABASE_URL=postgresql://root/app",
				"OBJECT_STORE_ENDPOINT=http://root-store:9000",
				"OBJECT_STORE_BUCKET_DERIVED=root-derived",
				"OBJECT_STORE_ACCESS_KEY=root-access",
				"OBJECT_STORE_SECRET_KEY=root-secret",
			].join("\n"),
		);
		writeFileSync(
			appEnv,
			[
				"APP_API_OPERATOR_DATABASE_URL=postgresql://app/app",
				"OBJECT_STORE_BUCKET_DERIVED=app-derived",
				"OBJECT_STORE_ACCESS_KEY=app-access",
			].join("\n"),
		);
		writeFileSync(
			commandEnv,
			[
				"APP_API_OPERATOR_DATABASE_URL=postgresql://command/app",
				"OBJECT_STORE_BUCKET_DERIVED=command-derived",
				"OBJECT_STORE_ACCESS_KEY=command-access",
				"OBJECT_STORE_SECRET_KEY=command-secret",
			].join("\n"),
		);

		const env = {
			APP_API_OPERATOR_DATABASE_URL: "postgresql://shell/app",
		};
		loadPrepareDocsReaderBuildEnvFiles(env, {
			defaultEnvFiles: [rootEnv, appEnv],
			overrideEnvFiles: [commandEnv],
		});

		expect(env).toMatchObject({
			APP_API_OPERATOR_DATABASE_URL: "postgresql://shell/app",
			OBJECT_STORE_ACCESS_KEY: "command-access",
			OBJECT_STORE_BUCKET_DERIVED: "command-derived",
			OBJECT_STORE_ENDPOINT: "http://root-store:9000",
			OBJECT_STORE_SECRET_KEY: "command-secret",
		});
	});
});

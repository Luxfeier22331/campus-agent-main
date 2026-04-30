import { describe, expect, it } from "vitest";

import packageManifestRaw from "../package.json?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

describe("public chat staging build script", () => {
	it("uses the repo-owned runtime secret placeholder wrapper", () => {
		const stagingBuild = packageManifest.scripts?.["build:staging"];

		expect(stagingBuild).toContain("run-worker-staging-build.mjs");
		expect(stagingBuild).toContain("SENTRY_DSN");
	});
});

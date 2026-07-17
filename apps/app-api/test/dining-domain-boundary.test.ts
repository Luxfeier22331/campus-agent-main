// @vitest-environment node

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

describe("dining domain boundary", () => {
	it("keeps app-api Dining as a public read adapter", () => {
		const forbiddenFiles = [
			"src/app/routes/dining-ops.ts",
			"src/modules/dining-ops/fengtai-outdoor-dining-zone.ts",
			"src/modules/dining-ops/floorplan-manifest.ts",
			"src/modules/dining-ops/guards.ts",
			"src/modules/dining-ops/hash.ts",
			"src/modules/dining-ops/bootstrap-catalog-fixture.ts",
			"src/modules/dining-ops/bootstrap-state.ts",
			"src/modules/dining-ops/projection.ts",
			"src/modules/dining-ops/release-lifecycle.ts",
			"src/modules/dining-ops/release-types.ts",
			"src/modules/dining-ops/review-fixture.ts",
			"src/modules/dining-ops/service-utils.ts",
			"src/modules/dining-ops/types.ts",
			"scripts/import-dining-bootstrap-fixture.ts",
			"scripts/refresh-dining-bootstrap-fixture.ts",
		];

		for (const relativePath of forbiddenFiles) {
			expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(false);
		}
	});
});

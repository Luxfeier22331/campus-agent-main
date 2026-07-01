import { loadOfficialWebConfig } from "official-web-core";
import { describe, expect, it, vi } from "vitest";
import { sourcePackPlanMain } from "../src/source-pack-plan-cli";
import { validateSourcePackConfig, validateSourcePackMain } from "../src/validate-source-pack";

describe("official-web-collector source-pack seam", () => {
	it("exposes the repo-tracked source-pack manifest through the shared official-web config bundle", () => {
		const config = loadOfficialWebConfig("muc_public");

		expect(config.sourcePackManifest.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(config.sourcePackManifest.entries.length).toBeGreaterThan(0);
		expect(
			config.sourcePackManifest.entries.some((entry) =>
				entry.ownerSurfaces.includes("calendar/academic_calendar"),
			),
		).toBe(true);
	});

	it("builds a machine-readable source-pack validation report", () => {
		const report = validateSourcePackConfig("muc_public");

		expect(report.valid).toBe(true);
		expect(report.siteId).toBe("muc_public");
		expect(report.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(report.entryCount).toBeGreaterThan(0);
	});

	it("prints source-pack validation report from the CLI entrypoint", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			validateSourcePackMain(["--site-id", "muc_public"]);
			expect(spy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(spy.mock.calls[0][0] as string) as {
				entryCount: number;
				siteId: string;
				sourcePackId: string;
				valid: boolean;
			};
			expect(payload.valid).toBe(true);
			expect(payload.siteId).toBe("muc_public");
			expect(payload.sourcePackId).toBe("tool-driven-first-slice.v1");
			expect(payload.entryCount).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("prints source-pack execution plan from the CLI entrypoint", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			sourcePackPlanMain(["--site-id", "muc_public"]);
			expect(spy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(spy.mock.calls[0][0] as string) as {
				entryCount: number;
				rows: Array<{ entryId: string; targetMatches: Array<{ targetId: string }> }>;
				siteId: string;
				sourcePackId: string;
			};
			expect(payload.siteId).toBe("muc_public");
			expect(payload.sourcePackId).toBe("tool-driven-first-slice.v1");
			expect(payload.entryCount).toBe(5);
			expect(payload.rows.some((row) => row.entryId === "synthetic-academic-calendar")).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("fails closed when an untracked source-pack id is requested", () => {
		expect(() =>
			validateSourcePackConfig("muc_public", {
				sourcePackId: "official-web-regulation-expansion.v1",
			}),
		).toThrowError(/official-web-regulation-expansion\.v1\.json/u);
	});
});

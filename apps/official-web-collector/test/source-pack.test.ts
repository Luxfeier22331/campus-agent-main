import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOfficialWebConfig } from "official-web-core";
import { describe, expect, it, vi } from "vitest";
import { sourcePackPlanMain } from "../src/source-pack-plan-cli";
import { validateSourcePackConfig, validateSourcePackMain } from "../src/validate-source-pack";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("official-web-collector source-pack seam", () => {
	it("exposes the repo-tracked source-pack manifest through the shared official-web config bundle", () => {
		const config = loadOfficialWebConfig("muc_public");

		expect(config.sourcePackManifest.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(config.sourcePackManifest.entries.length).toBeGreaterThan(0);
		expect(
			config.sourcePackManifest.entries.some((entry) =>
				entry.ownerSurfaces.includes("service_guide_lookup"),
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
			expect(payload.entryCount).toBeGreaterThan(0);
			expect(payload.rows.some((row) => row.entryId === "owsp-campus-card-met-1127")).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("supports alternate source-pack ids from the CLI seam", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			validateSourcePackMain([
				"--site-id",
				"muc_public",
				"--source-pack-id",
				"official-web-regulation-expansion.v1",
			]);
			expect(spy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(spy.mock.calls[0][0] as string) as {
				sourcePackId: string;
				valid: boolean;
			};
			expect(payload.valid).toBe(true);
			expect(payload.sourcePackId).toBe("official-web-regulation-expansion.v1");
		} finally {
			spy.mockRestore();
		}
	});

	it("validates the public regulation closeout source-pack manifest", () => {
		const report = validateSourcePackConfig("muc_public", {
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});

		expect(report.valid).toBe(true);
		expect(report.sourcePackId).toBe("official-web-public-regulation-closeout.v1");
		expect(report.entryCount).toBe(29);
		expect(
			report.entries.some(
				(entry) =>
					entry.entryId === "owsp-closeout-it-campus-card-policy-1086" &&
					entry.url === "https://met.muc.edu.cn/info/1024/1086.htm",
			),
		).toBe(true);
		expect(
			report.entries.some(
				(entry) =>
					entry.entryId === "owsp-closeout-student-rules-jlycf-listing" &&
					entry.url === "https://xxgk.muc.edu.cn/xsgz/jlycf/1.htm",
			),
		).toBe(true);
	});

	it("keeps every downstream public regulation consumption target as a direct answer-bearing source-pack row", () => {
		const config = loadOfficialWebConfig("muc_public", {
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});
		const consumptionManifest = JSON.parse(
			readFileSync(
				resolve(REPO_ROOT, "configs/ingestion/regulations/public-regulation-consumption.v1.json"),
				"utf8",
			),
		) as { documents: Array<{ source_url: string; title: string }> };
		const directAnswerBearingUrls = new Set(
			config.sourcePackManifest.entries
				.filter((entry) => entry.answerBearing)
				.map((entry) => entry.url),
		);
		const missing = consumptionManifest.documents
			.filter((entry) => !directAnswerBearingUrls.has(entry.source_url))
			.map((entry) => `${entry.title} <${entry.source_url}>`);

		expect(missing).toEqual([]);
	});

	it("validates the public regulation net-new student html source-pack manifest", () => {
		const report = validateSourcePackConfig("muc_public", {
			sourcePackId: "official-web-public-regulation-net-new-student-html.v1",
		});

		expect(report.valid).toBe(true);
		expect(report.sourcePackId).toBe("official-web-public-regulation-net-new-student-html.v1");
		expect(report.entryCount).toBe(2);
		expect(report.entries.map((entry) => entry.entryId).sort()).toEqual([
			"owsp-net-new-adult-bachelor-degree-6631",
			"owsp-net-new-adult-course-assessment-6641",
		]);
	});

	it("validates the public regulation net-new download-reference follow-up manifest", () => {
		const report = validateSourcePackConfig("muc_public", {
			sourcePackId: "official-web-public-regulation-net-new-download-followup.v1",
		});

		expect(report.valid).toBe(true);
		expect(report.sourcePackId).toBe("official-web-public-regulation-net-new-download-followup.v1");
		expect(report.entryCount).toBe(2);
		expect(report.entries.map((entry) => entry.entryId).sort()).toEqual([
			"owsp-net-new-degree-award-rules-download-5381",
			"owsp-net-new-discipline-relief-download-5211",
		]);
	});
});

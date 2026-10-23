// @vitest-environment node

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	normalizeCampusMapAssets,
	parseCampusMapCommandArgs,
	updateCampusMapSnapshot,
	validateCampusMapAssets,
	validateCampusMapRelease,
} from "../scripts/campus-map/generate.ts";

const dataRoot = fileURLToPath(new URL("../data/campus-map/", import.meta.url));
const assetRoot = fileURLToPath(new URL("../assets/campus-map/", import.meta.url));

describe("campus map generator", () => {
	it("parses one snapshot campus and rejects the retired update mode", () => {
		expect(parseCampusMapCommandArgs(["--snapshot-update", "--campus=fengtai"])).toEqual({
			campus: "fengtai",
			mode: "snapshot-update",
		});
		expect(() => parseCampusMapCommandArgs(["--snapshot-update"])).toThrow(
			"--snapshot-update requires --campus=fengtai or --campus=haidian.",
		);
		expect(() => parseCampusMapCommandArgs(["--update", "--campus=fengtai"])).toThrow(
			"Unknown campus map argument: --update",
		);
	});

	it("normalizes curated data into a source-consistent content-addressed release", () => {
		const candidateAssetRoot = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		try {
			const result = normalizeCampusMapAssets({ assetRoot: candidateAssetRoot, dataRoot });
			expect(result.geojsonDigests.fengtai).toMatch(/^[0-9a-f]{64}$/u);
			expect(result.geojsonDigests.haidian).toMatch(/^[0-9a-f]{64}$/u);
			expect(result.placesDigest).toMatch(/^[0-9a-f]{64}$/u);
			validateCampusMapAssets(candidateAssetRoot);
			validateCampusMapRelease({ assetRoot: candidateAssetRoot, dataRoot });
			expect(normalizeCampusMapAssets({ assetRoot: candidateAssetRoot, dataRoot })).toEqual(result);
			expect(
				normalizeCampusMapAssets({ campus: "fengtai", assetRoot: candidateAssetRoot, dataRoot }),
			).toEqual(result);
		} finally {
			rmSync(candidateAssetRoot, { force: true, recursive: true });
		}
	});

	it("validates the checked-in source and published release together", () => {
		expect(() => validateCampusMapRelease({ assetRoot, dataRoot })).not.toThrow();
	});

	it("rejects curated source that was not normalized into the manifest", () => {
		const dataCopy = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		const assetCopy = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		try {
			cpSync(dataRoot, dataCopy, { recursive: true });
			cpSync(assetRoot, assetCopy, { recursive: true });
			const curatedPath = join(dataCopy, "curated", "fengtai.geojson");
			const curated = JSON.parse(readFileSync(curatedPath, "utf8")) as {
				features: Array<{ properties: Record<string, unknown> }>;
			};
			const firstFeature = curated.features[0];
			if (!firstFeature) {
				throw new Error("Fixture Fengtai collection is empty");
			}
			firstFeature.properties.reviewMarker = "not-published";
			writeFileSync(curatedPath, `${JSON.stringify(curated)}\n`);
			expect(() => validateCampusMapRelease({ assetRoot: assetCopy, dataRoot: dataCopy })).toThrow(
				"Curated source digest does not match the published fengtai asset.",
			);
		} finally {
			rmSync(dataCopy, { force: true, recursive: true });
			rmSync(assetCopy, { force: true, recursive: true });
		}
	});

	it("rejects places source that was not normalized into the manifest", () => {
		const dataCopy = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		const assetCopy = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		try {
			cpSync(dataRoot, dataCopy, { recursive: true });
			cpSync(assetRoot, assetCopy, { recursive: true });
			const placesPath = join(dataCopy, "places.source.json");
			const places = JSON.parse(readFileSync(placesPath, "utf8")) as {
				places: Array<{ tags: string[] }>;
			};
			const firstPlace = places.places[0];
			if (!firstPlace) {
				throw new Error("Fixture places document is empty");
			}
			firstPlace.tags.push("not-published");
			writeFileSync(placesPath, `${JSON.stringify(places)}\n`);
			expect(() => validateCampusMapRelease({ assetRoot: assetCopy, dataRoot: dataCopy })).toThrow(
				"Places source digest does not match the published asset.",
			);
		} finally {
			rmSync(dataCopy, { force: true, recursive: true });
			rmSync(assetCopy, { force: true, recursive: true });
		}
	});

	it("does not replace an unreadable existing manifest", () => {
		const candidateAssetRoot = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		try {
			writeFileSync(join(candidateAssetRoot, "manifest.json"), "not-json\n");
			expect(() => normalizeCampusMapAssets({ assetRoot: candidateAssetRoot, dataRoot })).toThrow(
				"Existing campus map manifest is invalid",
			);
		} finally {
			rmSync(candidateAssetRoot, { force: true, recursive: true });
		}
	});

	it("validates the complete candidate before changing an existing manifest", () => {
		const candidateAssetRoot = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		const candidateDataRoot = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		try {
			cpSync(assetRoot, candidateAssetRoot, { recursive: true });
			cpSync(dataRoot, candidateDataRoot, { recursive: true });
			const placesPath = join(candidateDataRoot, "places.source.json");
			const places = JSON.parse(readFileSync(placesPath, "utf8")) as {
				places: Array<{ campus: string; mapFeatureRefs?: unknown[] }>;
			};
			const firstPlace = places.places.find((place) => place.campus === "丰台校区");
			if (!firstPlace) {
				throw new Error("Fixture Fengtai places document is empty");
			}
			firstPlace.mapFeatureRefs = [
				{ fid: 999999999, layer: "building", sourceId: "fengtai-campus" },
			];
			writeFileSync(placesPath, `${JSON.stringify(places)}\n`);
			const manifestPath = join(candidateAssetRoot, "manifest.json");
			const before = readFileSync(manifestPath);
			expect(() =>
				normalizeCampusMapAssets({ assetRoot: candidateAssetRoot, dataRoot: candidateDataRoot }),
			).toThrow("references missing feature");
			expect(readFileSync(manifestPath)).toEqual(before);
		} finally {
			rmSync(candidateAssetRoot, { force: true, recursive: true });
			rmSync(candidateDataRoot, { force: true, recursive: true });
		}
	});

	it("rejects a candidate that loses a campus boundary", () => {
		const candidateAssetRoot = mkdtempSync(join(tmpdir(), "campus-map-assets-"));
		const candidateDataRoot = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		try {
			cpSync(assetRoot, candidateAssetRoot, { recursive: true });
			cpSync(dataRoot, candidateDataRoot, { recursive: true });
			const curatedPath = join(candidateDataRoot, "curated", "haidian.geojson");
			const curated = JSON.parse(readFileSync(curatedPath, "utf8")) as {
				features: Array<{ properties: { layer: string } }>;
			};
			curated.features = curated.features.filter(
				(feature) => feature.properties.layer !== "boundary",
			);
			writeFileSync(curatedPath, `${JSON.stringify(curated)}\n`);
			const manifestPath = join(candidateAssetRoot, "manifest.json");
			const before = readFileSync(manifestPath);
			expect(() =>
				normalizeCampusMapAssets({
					campus: "haidian",
					assetRoot: candidateAssetRoot,
					dataRoot: candidateDataRoot,
				}),
			).toThrow("Missing campus boundary feature: haidian");
			expect(readFileSync(manifestPath)).toEqual(before);
		} finally {
			rmSync(candidateAssetRoot, { force: true, recursive: true });
			rmSync(candidateDataRoot, { force: true, recursive: true });
		}
	});

	it("updates only the selected snapshot after validating Overpass data", async () => {
		const dataCopy = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		try {
			cpSync(dataRoot, dataCopy, { recursive: true });
			const unchangedFiles = [
				join(dataCopy, "curated", "fengtai.geojson"),
				join(dataCopy, "curated", "haidian.geojson"),
				join(dataCopy, "places.source.json"),
				join(dataCopy, "snapshots", "haidian.overpass.json"),
			].map((filePath) => [filePath, readFileSync(filePath)] as const);
			const snapshot = {
				elements: [
					{ geometry: [{ lat: 39.81, lon: 116.11 }], id: 42, type: "way" },
					{ id: 42, members: [], type: "relation" },
				],
				generator: "test",
			};
			let requestBody = "";
			await updateCampusMapSnapshot("fengtai", {
				dataRoot: dataCopy,
				fetcher: (async (_url, init) => {
					requestBody = String(init?.body ?? "");
					return new Response(JSON.stringify(snapshot), {
						headers: { "content-type": "application/json" },
					});
				}) as typeof fetch,
			});
			expect(
				JSON.parse(readFileSync(join(dataCopy, "snapshots", "fengtai.overpass.json"), "utf8")),
			).toEqual(snapshot);
			expect(new URLSearchParams(requestBody).get("data")).toContain(
				"39.80568409255671,116.10310136576231,39.8142909422097,116.11805609538932",
			);
			for (const [filePath, before] of unchangedFiles) {
				expect(readFileSync(filePath)).toEqual(before);
			}
		} finally {
			rmSync(dataCopy, { force: true, recursive: true });
		}
	});

	it.each([
		["empty snapshot", { elements: [] }, "Invalid Overpass snapshot"],
		["unsupported element", { elements: [{ id: 1, type: "node" }] }, "Invalid Overpass element"],
		["invalid element id", { elements: [{ id: 0, type: "way" }] }, "Invalid Overpass element"],
		[
			"duplicate element",
			{
				elements: [
					{ id: 1, type: "way" },
					{ id: 1, type: "way" },
				],
			},
			"Duplicate Overpass element",
		],
	] as const)("keeps the previous snapshot for %s", async (_label, payload, expectedError) => {
		const dataCopy = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		try {
			cpSync(dataRoot, dataCopy, { recursive: true });
			const snapshotPath = join(dataCopy, "snapshots", "fengtai.overpass.json");
			const before = readFileSync(snapshotPath);
			await expect(
				updateCampusMapSnapshot("fengtai", {
					dataRoot: dataCopy,
					fetcher: (async () =>
						new Response(JSON.stringify(payload), {
							headers: { "content-type": "application/json" },
						})) as typeof fetch,
				}),
			).rejects.toThrow(expectedError);
			expect(readFileSync(snapshotPath)).toEqual(before);
		} finally {
			rmSync(dataCopy, { force: true, recursive: true });
		}
	});

	it("keeps the previous snapshot when Overpass returns an HTTP error", async () => {
		const dataCopy = mkdtempSync(join(tmpdir(), "campus-map-data-"));
		try {
			cpSync(dataRoot, dataCopy, { recursive: true });
			const snapshotPath = join(dataCopy, "snapshots", "fengtai.overpass.json");
			const before = readFileSync(snapshotPath);
			await expect(
				updateCampusMapSnapshot("fengtai", {
					dataRoot: dataCopy,
					fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
				}),
			).rejects.toThrow("Overpass request failed with HTTP 503.");
			expect(readFileSync(snapshotPath)).toEqual(before);
		} finally {
			rmSync(dataCopy, { force: true, recursive: true });
		}
	});
});

// @vitest-environment node

import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serveCampusMapDevelopmentAsset } from "../vite.config.ts";

const GEOJSON_DIGEST = "a".repeat(64);
const PLACES_DIGEST = "b".repeat(64);

interface TestResponse {
	body?: Uint8Array;
	headers: Map<string, string>;
	statusCode: number;
}

const temporaryRoots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

function createAssetRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "campus-map-development-assets-"));
	temporaryRoots.push(root);
	mkdirSync(join(root, "assets"));
	mkdirSync(join(root, "places"));
	writeFileSync(join(root, "manifest.json"), '{"version":1}\n');
	writeFileSync(
		join(root, "assets", `${GEOJSON_DIGEST}.geojson`),
		'{"type":"FeatureCollection"}\n',
	);
	writeFileSync(join(root, "places", `${PLACES_DIGEST}.json`), '{"places":[]}\n');
	writeFileSync(join(root, "README.md"), "private asset notes\n");
	return root;
}

function requestAsset(sourceRoot: string, method: string, url: string): TestResponse {
	const headers = new Map<string, string>();
	const response: TestResponse = {
		headers,
		statusCode: 0,
	};
	const middlewareResponse = {
		end(chunk?: Uint8Array) {
			if (chunk !== undefined) {
				response.body = chunk;
			}
		},
		setHeader(name: string, value: string) {
			headers.set(name.toLowerCase(), value);
		},
		statusCode: response.statusCode,
	};
	serveCampusMapDevelopmentAsset({
		request: { method, url },
		response: middlewareResponse,
		sourceRoot,
	});
	response.statusCode = middlewareResponse.statusCode;
	return response;
}

describe("campus map development assets", () => {
	it("serves manifest, GeoJSON, and places for GET and HEAD with shared headers", () => {
		const sourceRoot = createAssetRoot();
		const cases = [
			{
				body: '{"version":1}\n',
				contentType: "application/json; charset=utf-8",
				path: "/manifest.json",
				cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
			},
			{
				body: '{"type":"FeatureCollection"}\n',
				contentType: "application/geo+json; charset=utf-8",
				path: `/assets/${GEOJSON_DIGEST}.geojson`,
				cacheControl: "public, max-age=31536000, immutable",
			},
			{
				body: '{"places":[]}\n',
				contentType: "application/json; charset=utf-8",
				path: `/places/${PLACES_DIGEST}.json`,
				cacheControl: "public, max-age=31536000, immutable",
			},
		] as const;

		for (const testCase of cases) {
			for (const method of ["GET", "HEAD"] as const) {
				const response = requestAsset(sourceRoot, method, testCase.path);
				expect(response.statusCode).toBe(200);
				expect(response.headers.get("content-type")).toBe(testCase.contentType);
				expect(response.headers.get("cache-control")).toBe(testCase.cacheControl);
				expect(
					response.body === undefined ? undefined : new TextDecoder().decode(response.body),
				).toBe(method === "HEAD" ? undefined : testCase.body);
			}
		}
	});

	it("returns a non-cacheable 404 for README and unknown digests", () => {
		const sourceRoot = createAssetRoot();
		for (const path of [
			"/README.md",
			`/assets/${"c".repeat(64)}.geojson`,
			"/assets/not-a-digest.geojson",
		]) {
			const response = requestAsset(sourceRoot, "GET", path);
			expect(response.statusCode).toBe(404);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.has("content-type")).toBe(false);
			expect(response.body).toBeUndefined();
		}
	});

	it("returns 404 for non-GET methods without touching the asset root", () => {
		const sourceRoot = createAssetRoot();
		const statSpy = vi.spyOn(fs, "statSync");
		const readSpy = vi.spyOn(fs, "readFileSync");

		for (const method of ["POST", "PUT", "OPTIONS"]) {
			const response = requestAsset(sourceRoot, method, "/manifest.json");
			expect(response.statusCode).toBe(404);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.has("content-type")).toBe(false);
			expect(response.body).toBeUndefined();
		}

		expect(statSpy).not.toHaveBeenCalled();
		expect(readSpy).not.toHaveBeenCalled();
	});

	it("rejects encoded and traversal paths before filesystem access", () => {
		const sourceRoot = createAssetRoot();
		const statSpy = vi.spyOn(fs, "statSync");
		const readSpy = vi.spyOn(fs, "readFileSync");

		for (const path of [
			"/manifest%2Ejson",
			"/assets/%2e%2e/manifest.json",
			"/assets/../README.md",
		]) {
			const response = requestAsset(sourceRoot, "GET", path);
			expect(response.statusCode).toBe(404);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.has("content-type")).toBe(false);
			expect(response.body).toBeUndefined();
		}

		expect(statSpy).not.toHaveBeenCalled();
		expect(readSpy).not.toHaveBeenCalled();
	});
});

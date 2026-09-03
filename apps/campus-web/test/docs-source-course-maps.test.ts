import { Buffer } from "node:buffer";
import type { DocsReader } from "campus-contracts/campus-docs";
import { describe, expect, it } from "vitest";
import { readPngDimensions } from "../src/docs-reader-build/png-dimensions.ts";
import { materializeDocsCourseMaps } from "../src/docs-reader-build/source-course-maps.ts";

describe("published course maps", () => {
	it("rejects non-PNG image formats before parsing dimensions", () => {
		const bytes = Buffer.alloc(16);
		bytes.write("icns", 0, "ascii");
		bytes.writeUInt32BE(bytes.length, 4);

		expect(() => readPngDimensions(bytes)).toThrow("expected PNG");
	});

	it("merges adjacent image parts and attaches logical maps to their reader subsection", () => {
		const reader = {
			docId: "curriculum:新闻传播学类本科人才培养方案",
			elements: [
				{
					anchor: "course-maps",
					kind: "heading",
					level: 2,
					rootUnitId: "course-maps-root",
					text: "六、课程地图",
				},
				{
					anchor: "journalism",
					kind: "heading",
					level: 3,
					rootUnitId: "journalism-root",
					text: "1. 新闻学",
				},
				{
					anchor: "advertising",
					kind: "heading",
					level: 3,
					rootUnitId: "advertising-root",
					text: "2. 广告学",
				},
			],
			schemaVersion: "campus_docs_reader.v3",
			supplements: [{ kind: "course_maps", path: "course-maps.json" }],
			versionId: "version-1",
		} satisfies DocsReader;
		const payload = materializeDocsCourseMaps({
			assets: new Map([
				["course-maps/journalism.png", imageBytes(1200, 600)],
				["course-maps/advertising-left.png", imageBytes(1000, 600)],
				["course-maps/advertising-right.png", imageBytes(356, 592)],
			]),
			documentTitle: "新闻传播学类本科人才培养方案",
			reader,
			sourceBytes: jsonBytes({
				blocks: [
					{
						blockId: "journalism-map",
						imagePath: "course-maps/journalism.png",
						pageNumber: 1,
						parentHeadingHint: "六、课程地图",
						regionBBoxProvider: [10, 20, 610, 320],
						title: "新闻学专业本科课程结构拓扑图",
					},
					{
						blockId: "advertising-map-left",
						imagePath: "course-maps/advertising-left.png",
						pageNumber: 2,
						parentHeadingHint: "六、课程地图",
						regionBBoxProvider: [10, 20, 510, 320],
						title: "六、课程地图",
					},
					{
						blockId: "advertising-map-right",
						imagePath: "course-maps/advertising-right.png",
						pageNumber: 2,
						parentHeadingHint: "六、课程地图",
						regionBBoxProvider: [522, 22, 700, 318],
						title: "六、课程地图",
					},
				],
				docId: "curriculum:新闻传播学类本科人才培养方案",
				schemaVersion: "curriculum_course_maps_reader_v1",
				versionId: "version-1",
			}),
		});

		expect(payload.schemaVersion).toBe("campus_docs_course_maps.v1");
		expect(payload.maps).toHaveLength(2);
		expect(payload.maps[0]).toMatchObject({
			parts: [{ height: 600, imagePath: "course-maps/journalism.png", width: 1200 }],
			targetRootUnitId: "journalism-root",
			title: "新闻学专业本科课程结构拓扑图",
		});
		expect(payload.maps[1]).toMatchObject({
			parts: [
				{ imagePath: "course-maps/advertising-left.png", partId: "advertising-map-left" },
				{ imagePath: "course-maps/advertising-right.png", partId: "advertising-map-right" },
			],
			targetRootUnitId: "advertising-root",
			title: "广告学课程地图",
		});
		expect(Object.keys(payload.maps[1] ?? {}).sort()).toEqual([
			"mapId",
			"parts",
			"targetRootUnitId",
			"title",
		]);
	});
});

function jsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function imageBytes(width: number, height: number): Uint8Array {
	const bytes = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

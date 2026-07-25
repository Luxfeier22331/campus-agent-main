import { describe, expect, it } from "vitest";
import { wrapDiningWindowLabel } from "../src/components/dining/dining-floorplan";

describe("Dining floorplan labels", () => {
	it("omits labels that cannot fit without changing the window geometry", () => {
		expect(wrapDiningWindowLabel("测试窗口", 31, 24)).toEqual([]);
		expect(wrapDiningWindowLabel("测试窗口", 32, 23)).toEqual([]);
	});

	it("keeps labels within the available character capacity", () => {
		expect(wrapDiningWindowLabel("测试窗口", 32, 24)).toEqual(["…"]);
		expect(wrapDiningWindowLabel("测试窗口", 88, 72)).toEqual(["测试窗口"]);
	});
});

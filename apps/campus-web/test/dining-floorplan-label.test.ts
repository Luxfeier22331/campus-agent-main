import { describe, expect, it } from "vitest";
import {
	fitDiningWindowLabel,
	wrapDiningWindowLabel,
} from "../src/components/dining/dining-floorplan";

describe("Dining floorplan labels", () => {
	it("omits labels that cannot fit without changing the window geometry", () => {
		expect(wrapDiningWindowLabel("测试窗口", 31, 24)).toEqual([]);
		expect(wrapDiningWindowLabel("测试窗口", 32, 23)).toEqual([]);
	});

	it("keeps labels within the available character capacity", () => {
		expect(wrapDiningWindowLabel("测试窗口", 32, 24)).toEqual(["…"]);
		expect(wrapDiningWindowLabel("测试窗口", 88, 72)).toEqual(["测试窗口"]);
	});

	it("uses the largest size that keeps the whole name without extra lines", () => {
		expect(fitDiningWindowLabel("麻辣烫", 88, 72)).toEqual({ fontSize: 22, lines: ["麻辣烫"] });
		expect(fitDiningWindowLabel("南北风味", 88, 76)).toEqual({ fontSize: 18, lines: ["南北风味"] });
	});

	it("falls back to the 16-unit wrapping when no larger size fits", () => {
		expect(fitDiningWindowLabel("测试窗口", 32, 24)).toEqual({ fontSize: 16, lines: ["…"] });
		expect(fitDiningWindowLabel("超长的窗口名称示例", 88, 72)).toEqual({
			fontSize: 16,
			lines: wrapDiningWindowLabel("超长的窗口名称示例", 88, 72),
		});
	});
});

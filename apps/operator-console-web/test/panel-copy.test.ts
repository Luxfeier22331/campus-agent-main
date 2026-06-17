import { describe, expect, it } from "vitest";

import {
	formatPanelPaginationAriaLabel,
	formatPanelPaginationDisplayedRows,
	formatPanelSortLabel,
	translateRuntimeErrorMessage,
} from "../src/panel/panel-copy";

describe("Operator Console chinese copy helpers", () => {
	it("formats pagination summaries in chinese for both bounded and partial pages", () => {
		expect(
			formatPanelPaginationDisplayedRows({
				count: 128,
				from: 1,
				hasNextPage: true,
				to: 20,
			}),
		).toBe("1-20 / 128");
		expect(
			formatPanelPaginationDisplayedRows({
				count: -1,
				from: 21,
				hasNextPage: true,
				to: 40,
			}),
		).toBe("21-40 / 超过 40");
		expect(
			formatPanelPaginationDisplayedRows({
				count: -1,
				from: 21,
				hasNextPage: false,
				to: 40,
			}),
		).toBe("21-40 / 40");
	});

	it("formats pagination aria labels in chinese", () => {
		expect(formatPanelPaginationAriaLabel({ page: 3, selected: false, type: "page" })).toBe(
			"前往第 3 页",
		);
		expect(formatPanelPaginationAriaLabel({ page: 3, selected: true, type: "page" })).toBe(
			"当前第 3 页",
		);
		expect(formatPanelPaginationAriaLabel({ type: "next" })).toBe("前往下一页");
		expect(formatPanelPaginationAriaLabel({ type: "previous" })).toBe("前往上一页");
	});

	it("formats datagrid sort labels in chinese", () => {
		expect(formatPanelSortLabel({ fieldLabel: "请求", order: "ASC" })).toBe("按请求排序（升序）");
		expect(formatPanelSortLabel({ fieldLabel: "开始时间", order: "DESC" })).toBe(
			"按开始时间排序（降序）",
		);
	});

	it("maps internal runtime errors to chinese operator-facing copy", () => {
		expect(
			translateRuntimeErrorMessage({
				code: "internal_error",
				message: "Unexpected app-api failure.",
				statusText: "Internal Server Error",
			}),
		).toBe("app-api 当前返回了未预期错误，请稍后重试。");
	});
});

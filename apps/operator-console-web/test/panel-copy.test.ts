import { describe, expect, it } from "vitest";

import { formatPanelTimestamp, translateRuntimeErrorMessage } from "../src/panel/panel-copy";

describe("Operator Console chinese copy helpers", () => {
	it("formats missing timestamps as pending copy", () => {
		expect(formatPanelTimestamp(null)).toBe("处理中");
	});

	it("maps internal runtime errors to chinese operator-facing copy", () => {
		expect(
			translateRuntimeErrorMessage({
				code: "internal_error",
				message: "Unexpected app-api failure.",
				statusText: "Internal Server Error",
			}),
		).toBe("服务暂时不可用，请稍后重试。");
	});
});

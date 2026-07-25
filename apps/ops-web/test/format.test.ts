import { describe, expect, it } from "vitest";
import {
	formatCurrencyUsd,
	formatDuration,
	formatId,
	formatPercent,
	formatTimestamp,
} from "../src/app/format";

describe("ops-web display formatting", () => {
	it("formats dense ops values for scanning", () => {
		expect(formatDuration(4280)).toBe("4.28s");
		expect(formatDuration(44)).toBe("44ms");
		expect(formatPercent(0.08)).toBe("8.0%");
		expect(formatCurrencyUsd(0.012)).toBe("$0.0120");
		expect(formatId("trace_ops_001")).toBe("trace_..._001");
		expect(formatTimestamp("2026-07-09T06:29:04.000Z")).toBe("2026-07-09 14:29:04");
	});

	it("uses explicit labels for missing values", () => {
		expect(formatDuration(null)).toBe("未记录耗时");
		expect(formatTimestamp(null)).toBe("未记录时间");
	});
});

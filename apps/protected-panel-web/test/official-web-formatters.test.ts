import { afterEach, describe, expect, it, vi } from "vitest";

import {
	formatIngestionStatusLabel,
	formatOfficialWebCadenceClassLabel,
	formatOfficialWebChangeReasonLabel,
	formatOfficialWebFreshnessSummaryLabel,
	formatOfficialWebPageChangeStatusLabel,
	formatOfficialWebPageChangeSummaryLabel,
	formatOfficialWebPageFamilyLabel,
	formatOfficialWebRunIntentLabel,
	formatOfficialWebRunSummaryLabel,
	formatOfficialWebStatusLabel,
	formatTimestamp,
} from "../src/panel/official-web/official-web-formatters";

describe("protected panel official web formatters", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("formats official web statuses in chinese", () => {
		expect(formatOfficialWebStatusLabel("completed_with_errors")).toBe("完成但有错误");
		expect(formatOfficialWebStatusLabel("abandoned")).toBe("已放弃");
		expect(formatIngestionStatusLabel("staged")).toBe("已暂存");
		expect(formatIngestionStatusLabel("promoted")).toBe("已提升");
		expect(formatIngestionStatusLabel("succeeded")).toBe("已成功");
		expect(formatIngestionStatusLabel("ingestion_failed")).toBe("分发失败");
		expect(formatIngestionStatusLabel(null)).toBe("暂无");
		expect(formatOfficialWebRunIntentLabel("repair")).toBe("修复");
		expect(formatOfficialWebRunSummaryLabel("urlsFetched")).toBe("抓取页面数");
		expect(formatOfficialWebPageChangeSummaryLabel("notModifiedPages")).toBe("未变更页面");
		expect(formatOfficialWebPageChangeStatusLabel("fetch_failed")).toBe("抓取失败");
		expect(formatOfficialWebPageFamilyLabel("listing_page")).toBe("列表页");
		expect(formatOfficialWebCadenceClassLabel("detail_recent")).toBe("近期详情");
		expect(formatOfficialWebChangeReasonLabel("main_content_changed")).toBe("正文发生变化");
		expect(formatOfficialWebFreshnessSummaryLabel("changedLast24h")).toBe("24 小时变更");
	});

	it("formats timestamps with zh-CN locale", () => {
		const formatMock = vi.fn().mockReturnValue("2026/04/05 19:30");
		class MockDateTimeFormat {
			constructor(locale: string, options: Intl.DateTimeFormatOptions) {
				expect(locale).toBe("zh-CN");
				expect(options).toEqual({
					dateStyle: "medium",
					timeStyle: "short",
				});
			}

			format = formatMock;
		}

		const dateTimeFormatSpy = vi
			.spyOn(Intl, "DateTimeFormat")
			.mockImplementation(MockDateTimeFormat as unknown as typeof Intl.DateTimeFormat);

		expect(formatTimestamp("2026-04-05T11:30:00.000Z")).toBe("2026/04/05 19:30");
		expect(dateTimeFormatSpy).toHaveBeenCalledTimes(1);
	});
});

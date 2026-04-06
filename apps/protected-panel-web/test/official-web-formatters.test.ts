import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatIngestionStatusLabel,
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
    expect(formatIngestionStatusLabel("ingestion_failed")).toBe("分发失败");
    expect(formatIngestionStatusLabel(null)).toBe("暂无");
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

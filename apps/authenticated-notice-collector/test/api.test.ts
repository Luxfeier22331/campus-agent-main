import { describe, expect, it } from "vitest";

import { fetchNoticePage } from "../src/api";

describe("authenticated notice collector api", () => {
  it("posts notice page requests and retries retryable failures", async () => {
    const calls: Array<{ path: string; form: Record<string, string> }> = [];
    let attempt = 0;
    const apiContext = {
      async post(path: string, input: { form: Record<string, string> }) {
        calls.push({ path, form: input.form });
        attempt += 1;
        if (attempt === 1) {
          return {
            json: async () => ({}),
            ok: () => false,
            status: () => 500,
            statusText: () => "server error",
          };
        }
        return {
          ok: () => true,
          status: () => 200,
          statusText: () => "OK",
          json: async () => ({
            datas: {
              tables: [{ notice_id: 355119, notice_title: "通知标题" }],
            },
            state: true,
          }),
        };
      },
    };

    const result = await fetchNoticePage({
      apiContext,
      currentPage: 1,
      noticeType: "5",
      pageSize: 3,
      requestBackoffBaseMs: 1,
      requestMaxRetries: 2,
      sleep: async () => {},
    });

    expect(result.datas?.tables).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.path).toBe("/comsys-portal-notice-web/getNoticeByPage");
    expect(calls[0]?.form.type).toBe("5");
    expect(calls[0]?.form.currentPage).toBe("1");
    expect(calls[0]?.form.pageSize).toBe("3");
  });
});

import { describe, expect, it } from "vitest";

import { checkAuth } from "../src/auth-check";

describe("authenticated notice collector auth check", () => {
  it("returns a summary from the first visible notice and disposes the request context", async () => {
    let disposed = false;

    const result = await checkAuth({
      authCheckNoticeType: "5",
      authCheckPageSize: 3,
      createApiContext: async () => ({
        post: async () => ({
          json: async () => ({}),
          ok: () => true,
          status: () => 200,
          statusText: () => "OK",
        }),
        dispose: async () => {
          disposed = true;
        },
      }),
      fetchNoticePage: async () => ({
        datas: {
          tables: [{ notice_id: 355119, notice_title: "关于报名的通知" }],
        },
        state: true,
      }),
    });

    expect(result).toEqual({
      firstNoticeId: 355119,
      firstTitle: "关于报名的通知",
      ok: true,
      sampleCount: 1,
    });
    expect(disposed).toBe(true);
  });

  it("fails closed when the session cannot access notice data", async () => {
    await expect(
      checkAuth({
        authCheckNoticeType: "5",
        authCheckPageSize: 3,
        createApiContext: async () => ({
          post: async () => ({
            json: async () => ({}),
            ok: () => true,
            status: () => 200,
            statusText: () => "OK",
          }),
          dispose: async () => {},
        }),
        fetchNoticePage: async () => ({
          datas: { tables: [] },
          state: true,
        }),
      }),
    ).rejects.toThrow("auth check failed");
  });
});

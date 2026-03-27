// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  AuthenticatedAppUserRedirectError,
  loadLoginPageData,
} from "../app/lib/login-boundary.server";

describe("login boundary server helpers", () => {
  it("allows the login route to render when there is no app session", async () => {
    await expect(
      loadLoginPageData({
        getUser: vi.fn().mockResolvedValue(null),
        request: new Request("http://127.0.0.1:3000/login"),
      }),
    ).resolves.toEqual({
      redirectTo: null,
    });
  });

  it("redirects authenticated users away from /login and into /chat", async () => {
    await expect(
      loadLoginPageData({
        getUser: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "student@example.com",
          name: "Student",
        }),
        request: new Request("http://127.0.0.1:3000/login"),
      }),
    ).rejects.toEqual(
      new AuthenticatedAppUserRedirectError(),
    );
  });
});

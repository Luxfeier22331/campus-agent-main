import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedPanelAuthProvider } from "../src/panel/auth-provider";

function createAccessLoginHtmlResponse(): Response {
  return {
    headers: new Headers({
      "cf-access-domain": "campus-panel-staging.ayafeed.com",
      "content-type": "text/html; charset=utf-8",
    }),
    ok: true,
    redirected: true,
    status: 200,
    statusText: "OK",
    text: vi.fn().mockResolvedValue("<!DOCTYPE html><title>Sign in ・ Cloudflare Access</title>"),
    url: "https://ayafeed.cloudflareaccess.com/cdn-cgi/access/login/campus-panel-staging.ayafeed.com",
  } as unknown as Response;
}

describe("protected panel auth provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    void protectedPanelAuthProvider.logout?.({});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed when /api/overview resolves to the Cloudflare Access login page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createAccessLoginHtmlResponse());

    await expect(protectedPanelAuthProvider.checkAuth?.({})).rejects.toMatchObject({
      redirectTo: "/login",
      status: 401,
    });
  });

  it("does not treat a 403 operator authorization failure as a login expiry", async () => {
    await expect(
      protectedPanelAuthProvider.checkError?.({
        message: "Operator access is forbidden.",
        status: 403,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps auth-check logout on the local login route instead of forcing upstream access logout", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        assign,
        origin: "https://campus-panel-staging.ayafeed.com",
      },
    });

    await expect(protectedPanelAuthProvider.logout?.({})).resolves.toBe("/login");
    expect(assign).not.toHaveBeenCalled();
  });

  it("routes explicit user logout through the Cloudflare Access logout endpoint", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        assign,
        origin: "https://campus-panel-staging.ayafeed.com",
      },
    });

    await expect(protectedPanelAuthProvider.logout?.(null)).resolves.toBe(
      "https://campus-panel-staging.ayafeed.com/cdn-cgi/access/logout",
    );
    expect(assign).not.toHaveBeenCalled();
  });
});

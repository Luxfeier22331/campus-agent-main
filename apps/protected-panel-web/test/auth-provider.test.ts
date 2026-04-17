// @vitest-environment node

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

function createPanelError(status: number, code?: string) {
  return {
    body: code
      ? {
          error: {
            code,
          },
        }
      : undefined,
    status,
  };
}

describe("protected panel auth provider", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    void protectedPanelAuthProvider.logout?.({});
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
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

  it("keeps operator admission and runtime failures in place instead of logging out", async () => {
    await expect(
      protectedPanelAuthProvider.checkError(createPanelError(403, "operator_identity_not_admitted")),
    ).resolves.toBeUndefined();

    await expect(
      protectedPanelAuthProvider.checkError(createPanelError(403, "forbidden")),
    ).resolves.toBeUndefined();

    await expect(
      protectedPanelAuthProvider.checkError(createPanelError(401, "internal_auth_required")),
    ).resolves.toBeUndefined();

    await expect(
      protectedPanelAuthProvider.checkError(createPanelError(503, "dependency_not_ready")),
    ).resolves.toBeUndefined();
  });

  it("still escalates session and access failures so react-admin can logout", async () => {
    const sessionRequired = createPanelError(401, "session_required");
    await expect(protectedPanelAuthProvider.checkError(sessionRequired)).rejects.toBe(sessionRequired);

    const accessJwtFailure = createPanelError(401);
    await expect(protectedPanelAuthProvider.checkError(accessJwtFailure)).rejects.toBe(
      accessJwtFailure,
    );
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

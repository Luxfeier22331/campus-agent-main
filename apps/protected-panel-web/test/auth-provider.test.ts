// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { protectedPanelAuthProvider } from "../src/panel/auth-provider";

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

describe("protectedPanelAuthProvider.checkError", () => {
  it("keeps operator admission and runtime failures in place instead of logging out", async () => {
    await expect(
      protectedPanelAuthProvider.checkError(
        createPanelError(403, "operator_identity_not_admitted"),
      ),
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
    await expect(
      protectedPanelAuthProvider.checkError(sessionRequired),
    ).rejects.toBe(sessionRequired);

    const accessJwtFailure = createPanelError(401);
    await expect(
      protectedPanelAuthProvider.checkError(accessJwtFailure),
    ).rejects.toBe(accessJwtFailure);
  });
});

describe("protectedPanelAuthProvider.logout", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it("redirects to the Cloudflare Access logout endpoint", async () => {
    const assign = vi.fn();
    globalThis.window = {
      location: {
        assign,
      },
    } as unknown as Window & typeof globalThis;

    await protectedPanelAuthProvider.logout?.({} as never);

    expect(assign).toHaveBeenCalledWith("/cdn-cgi/access/logout");
  });
});

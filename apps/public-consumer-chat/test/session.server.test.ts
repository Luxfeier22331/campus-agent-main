// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, getServerSession } from "../app/lib/session.server";

describe("session server helpers", () => {
  it("reads the Better Auth session from a unified helper", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "student@example.com",
        name: "Student",
      },
    });

    const session = await getServerSession(new Request("http://127.0.0.1:3000/chat"), {
      auth: {
        api: {
          getSession,
        },
      },
    });

    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(session?.user?.id).toBe("user-1");
  });

  it("maps the Better Auth session user into the app-local authenticated user shape", async () => {
    const user = await getAuthenticatedUser(new Request("http://127.0.0.1:3000/chat"), {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            user: {
              id: "user-1",
              email: "student@example.com",
              name: "Student",
            },
          }),
        },
      },
    });

    expect(user).toEqual({
      email: "student@example.com",
      id: "user-1",
      name: "Student",
    });
  });

  it("returns null when Better Auth does not resolve an authenticated app user", async () => {
    const user = await getAuthenticatedUser(new Request("http://127.0.0.1:3000/chat"), {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue(null),
        },
      },
    });

    expect(user).toBeNull();
  });
});

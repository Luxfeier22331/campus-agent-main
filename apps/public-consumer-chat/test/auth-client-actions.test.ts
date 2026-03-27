import { afterEach, describe, expect, it, vi } from "vitest";

const mockedAuthClient = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signOut: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("../app/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: mockedAuthClient.signInEmail,
    },
    signUp: {
      email: mockedAuthClient.signUpEmail,
    },
    signOut: mockedAuthClient.signOut,
  },
}));

import {
  signOutAppSession,
  submitEmailPasswordAuth,
} from "../app/lib/auth-client-actions";

describe("auth client actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses Better Auth sign-in email client calls instead of manual endpoint fetches", async () => {
    mockedAuthClient.signInEmail.mockResolvedValue({
      data: {
        ok: true,
      },
      error: null,
    });

    await submitEmailPasswordAuth("sign-in", {
      email: "student@example.com",
      name: "Ignored For Sign In",
      password: "password123",
    });

    expect(mockedAuthClient.signInEmail).toHaveBeenCalledWith({
      callbackURL: "/chat",
      email: "student@example.com",
      password: "password123",
      rememberMe: true,
    });
    expect(mockedAuthClient.signUpEmail).not.toHaveBeenCalled();
  });

  it("uses Better Auth sign-up email client calls for registration", async () => {
    mockedAuthClient.signUpEmail.mockResolvedValue({
      data: {
        ok: true,
      },
      error: null,
    });

    await submitEmailPasswordAuth("sign-up", {
      email: "student@example.com",
      name: "Campus Agent Student",
      password: "password123",
    });

    expect(mockedAuthClient.signUpEmail).toHaveBeenCalledWith({
      callbackURL: "/chat",
      email: "student@example.com",
      name: "Campus Agent Student",
      password: "password123",
    });
    expect(mockedAuthClient.signInEmail).not.toHaveBeenCalled();
  });

  it("surfaces Better Auth client errors as plain route-safe messages", async () => {
    mockedAuthClient.signInEmail.mockResolvedValue({
      data: null,
      error: {
        message: "Invalid email or password.",
      },
    });

    await expect(
      submitEmailPasswordAuth("sign-in", {
        email: "student@example.com",
        name: "Ignored",
        password: "wrong-password",
      }),
    ).rejects.toThrow("Invalid email or password.");
  });

  it("signs out through the Better Auth client", async () => {
    mockedAuthClient.signOut.mockResolvedValue({
      data: {
        success: true,
      },
      error: null,
    });

    await signOutAppSession();

    expect(mockedAuthClient.signOut).toHaveBeenCalledWith();
  });
});

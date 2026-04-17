import { beforeEach, describe, expect, it, vi } from "vitest";

const submitEmailPasswordAuth = vi.fn<
  (mode: "sign-in" | "sign-up", values: { email: string; name: string; password: string }) => Promise<void>
>();

class MockAuthSubmissionError extends Error {
  constructor(
    readonly code: "failed" | "invalid_data" | "user_exists",
    message: string,
  ) {
    super(message);
    this.name = "MockAuthSubmissionError";
  }
}

vi.mock("../src/platform/auth/client", () => ({
  AuthSubmissionError: MockAuthSubmissionError,
  submitEmailPasswordAuth,
}));

describe("public chat auth action adapters", () => {
  beforeEach(() => {
    submitEmailPasswordAuth.mockReset();
  });

  it("rejects malformed login submissions before hitting the auth client", async () => {
    const { login } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("email", "invalid-email");
    formData.set("password", "short");

    await expect(login({ status: "idle" }, formData)).resolves.toEqual({
      status: "invalid_data",
    });
    expect(submitEmailPasswordAuth).not.toHaveBeenCalled();
  });

  it("derives the Better Auth name field from email when registering through the donor shell", async () => {
    const { register } = await import("../src/login/actions");
    submitEmailPasswordAuth.mockResolvedValue(undefined);
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(register({ status: "idle" }, formData)).resolves.toEqual({
      status: "success",
    });
    expect(submitEmailPasswordAuth).toHaveBeenCalledWith("sign-up", {
      email: "student@muc.edu.cn",
      name: "student@muc.edu.cn",
      password: "Password!2026",
    });
  });

  it("maps duplicate-account failures to the donor register action state", async () => {
    const { register } = await import("../src/login/actions");
    submitEmailPasswordAuth.mockRejectedValue(
      new MockAuthSubmissionError("user_exists", "Account already exists!"),
    );
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(register({ status: "idle" }, formData)).resolves.toEqual({
      status: "user_exists",
    });
  });

  it("maps auth failures on login to the donor login action state", async () => {
    const { login } = await import("../src/login/actions");
    submitEmailPasswordAuth.mockRejectedValue(
      new MockAuthSubmissionError("failed", "Invalid credentials!"),
    );
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(login({ status: "idle" }, formData)).resolves.toEqual({
      status: "failed",
    });
  });
});

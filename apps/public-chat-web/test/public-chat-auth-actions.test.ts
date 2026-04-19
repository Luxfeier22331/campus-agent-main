import { beforeEach, describe, expect, it, vi } from "vitest";

const submitEmailPasswordAuth = vi.fn<
  (
    mode: "sign-in" | "sign-up",
    values: { captchaToken: string; email: string; name: string; password: string },
  ) => Promise<void>
>();
const requestPasswordReset = vi.fn<
  (values: { captchaToken: string; email: string; redirectTo?: string }) => Promise<void>
>();
const resetPasswordWithToken = vi.fn<
  (values: { newPassword: string; token: string }) => Promise<void>
>();

class MockAuthSubmissionError extends Error {
  constructor(
    readonly code: "failed" | "invalid_data" | "invalid_token" | "user_exists",
    message: string,
  ) {
    super(message);
    this.name = "MockAuthSubmissionError";
  }
}

vi.mock("../src/platform/auth/client", () => ({
  AuthSubmissionError: MockAuthSubmissionError,
  requestPasswordReset,
  resetPasswordWithToken,
  submitEmailPasswordAuth,
}));

describe("public chat auth action adapters", () => {
  beforeEach(() => {
    requestPasswordReset.mockReset();
    resetPasswordWithToken.mockReset();
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
    formData.set("captchaToken", "captcha-token-01");
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(register({ status: "idle" }, formData)).resolves.toEqual({
      status: "success",
    });
    expect(submitEmailPasswordAuth).toHaveBeenCalledWith("sign-up", {
      captchaToken: "captcha-token-01",
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
    formData.set("captchaToken", "captcha-token-01");
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
    formData.set("captchaToken", "captcha-token-01");
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(login({ status: "idle" }, formData)).resolves.toEqual({
      status: "failed",
    });
  });

  it("rejects malformed forgot-password submissions before hitting the auth client", async () => {
    const { requestPasswordRecovery } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("email", "invalid-email");

    await expect(
      requestPasswordRecovery({ status: "idle" }, formData),
    ).resolves.toEqual({
      status: "invalid_data",
    });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("requires captcha before login hits the auth client", async () => {
    const { login } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(login({ status: "idle" }, formData)).resolves.toEqual({
      status: "captcha_required",
    });
    expect(submitEmailPasswordAuth).not.toHaveBeenCalled();
  });

  it("requires captcha before registration hits the auth client", async () => {
    const { register } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");
    formData.set("password", "Password!2026");

    await expect(register({ status: "idle" }, formData)).resolves.toEqual({
      status: "captcha_required",
    });
    expect(submitEmailPasswordAuth).not.toHaveBeenCalled();
  });

  it("requires captcha before forgot-password hits the auth client", async () => {
    const { requestPasswordRecovery } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("email", "student@muc.edu.cn");

    await expect(
      requestPasswordRecovery({ status: "idle" }, formData),
    ).resolves.toEqual({
      status: "captcha_required",
    });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("maps forgot-password success to a neutral success state", async () => {
    const { requestPasswordRecovery } = await import("../src/login/actions");
    requestPasswordReset.mockResolvedValue(undefined);
    const formData = new FormData();
    formData.set("captchaToken", "captcha-token-01");
    formData.set("email", "student@muc.edu.cn");

    await expect(
      requestPasswordRecovery({ status: "idle" }, formData),
    ).resolves.toEqual({
      status: "success",
    });
    expect(requestPasswordReset).toHaveBeenCalledWith({
      captchaToken: "captcha-token-01",
      email: "student@muc.edu.cn",
    });
  });

  it("rejects malformed reset-password submissions before hitting the auth client", async () => {
    const { resetPassword } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("password", "short");
    formData.set("confirmPassword", "different");

    await expect(
      resetPassword({ status: "idle", token: "reset_token_01HQ" }, formData),
    ).resolves.toEqual({
      status: "invalid_data",
      token: "reset_token_01HQ",
    });
    expect(resetPasswordWithToken).not.toHaveBeenCalled();
  });

  it("fails closed when reset-password is submitted without a token", async () => {
    const { resetPassword } = await import("../src/login/actions");
    const formData = new FormData();
    formData.set("password", "Password!2026");
    formData.set("confirmPassword", "Password!2026");

    await expect(
      resetPassword({ status: "idle", token: null }, formData),
    ).resolves.toEqual({
      status: "invalid_token",
      token: null,
    });
    expect(resetPasswordWithToken).not.toHaveBeenCalled();
  });

  it("maps invalid token reset failures to the recovery action state", async () => {
    const { resetPassword } = await import("../src/login/actions");
    resetPasswordWithToken.mockRejectedValue(
      new MockAuthSubmissionError("invalid_token", "Invalid token"),
    );
    const formData = new FormData();
    formData.set("password", "Password!2026");
    formData.set("confirmPassword", "Password!2026");

    await expect(
      resetPassword({ status: "idle", token: "reset_token_01HQ" }, formData),
    ).resolves.toEqual({
      status: "invalid_token",
      token: "reset_token_01HQ",
    });
  });
});

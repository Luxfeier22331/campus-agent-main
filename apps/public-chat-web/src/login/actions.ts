import {
  AuthSubmissionError,
  requestPasswordReset,
  resetPasswordWithToken,
  submitEmailPasswordAuth,
} from "../platform/auth/client";

const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "invalid_data"
    | "captcha_required";
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "captcha_required"
    | "user_exists"
    | "invalid_data";
};

export type PasswordRecoveryActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "invalid_data"
    | "captcha_required";
};

export type ResetPasswordActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "invalid_data"
    | "invalid_token";
  token: string | null;
};

function readFormField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function isValidPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH;
}

function deriveRegistrationName(email: string): string {
  return email;
}

function readEmailPasswordSubmission(formData: FormData) {
  return {
    captchaToken: readFormField(formData, "captchaToken"),
    email: readFormField(formData, "email"),
    password: readFormField(formData, "password"),
  };
}

function readPasswordResetSubmission(formData: FormData) {
  return {
    confirmPassword: readFormField(formData, "confirmPassword"),
    password: readFormField(formData, "password"),
  };
}

function readPasswordRecoverySubmission(formData: FormData) {
  return {
    captchaToken: readFormField(formData, "captchaToken"),
    email: readFormField(formData, "email"),
  };
}

function isValidEmailPasswordSubmission(input: {
  email: string;
  password: string;
}): boolean {
  return isValidEmail(input.email) && isValidPassword(input.password);
}

function hasCaptchaToken(value: string): boolean {
  return value.length > 0;
}

function isValidPasswordResetSubmission(input: {
  confirmPassword: string;
  password: string;
}): boolean {
  return isValidPassword(input.password) && input.password === input.confirmPassword;
}

function mapLoginError(error: unknown): LoginActionState {
  if (error instanceof AuthSubmissionError && error.code === "captcha_required") {
    return { status: "captcha_required" };
  }

  if (error instanceof AuthSubmissionError && error.code === "invalid_data") {
    return { status: "invalid_data" };
  }

  return { status: "failed" };
}

function mapRegisterError(error: unknown): RegisterActionState {
  if (!(error instanceof AuthSubmissionError)) {
    return { status: "failed" };
  }

  if (error.code === "user_exists") {
    return { status: "user_exists" };
  }

  if (error.code === "captcha_required") {
    return { status: "captcha_required" };
  }

  if (error.code === "invalid_data") {
    return { status: "invalid_data" };
  }

  return { status: "failed" };
}

function mapPasswordRecoveryError(error: unknown): PasswordRecoveryActionState {
  if (error instanceof AuthSubmissionError && error.code === "captcha_required") {
    return { status: "captcha_required" };
  }

  if (error instanceof AuthSubmissionError && error.code === "invalid_data") {
    return { status: "invalid_data" };
  }

  return { status: "failed" };
}

function mapResetPasswordError(
  error: unknown,
  token: string | null,
): ResetPasswordActionState {
  if (!(error instanceof AuthSubmissionError)) {
    return { status: "failed", token };
  }

  if (error.code === "invalid_token") {
    return { status: "invalid_token", token };
  }

  if (error.code === "invalid_data") {
    return { status: "invalid_data", token };
  }

  return { status: "failed", token };
}

export async function login(
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const submission = readEmailPasswordSubmission(formData);

  if (!isValidEmailPasswordSubmission(submission)) {
    return { status: "invalid_data" };
  }
  if (!hasCaptchaToken(submission.captchaToken)) {
    return { status: "captcha_required" };
  }

  try {
    await submitEmailPasswordAuth("sign-in", {
      captchaToken: submission.captchaToken,
      email: submission.email,
      name: "",
      password: submission.password,
    });

    return { status: "success" };
  } catch (error) {
    return mapLoginError(error);
  }
}

export async function register(
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const submission = readEmailPasswordSubmission(formData);

  if (!isValidEmailPasswordSubmission(submission)) {
    return { status: "invalid_data" };
  }
  if (!hasCaptchaToken(submission.captchaToken)) {
    return { status: "captcha_required" };
  }

  try {
    await submitEmailPasswordAuth("sign-up", {
      captchaToken: submission.captchaToken,
      email: submission.email,
      name: deriveRegistrationName(submission.email),
      password: submission.password,
    });

    return { status: "success" };
  } catch (error) {
    return mapRegisterError(error);
  }
}

export async function requestPasswordRecovery(
  _: PasswordRecoveryActionState,
  formData: FormData,
): Promise<PasswordRecoveryActionState> {
  const submission = readPasswordRecoverySubmission(formData);

  if (!isValidEmail(submission.email)) {
    return { status: "invalid_data" };
  }
  if (!hasCaptchaToken(submission.captchaToken)) {
    return { status: "captcha_required" };
  }

  try {
    await requestPasswordReset({
      captchaToken: submission.captchaToken,
      email: submission.email,
    });
    return { status: "success" };
  } catch (error) {
    return mapPasswordRecoveryError(error);
  }
}

export async function resetPassword(
  state: ResetPasswordActionState,
  formData: FormData,
): Promise<ResetPasswordActionState> {
  const submission = readPasswordResetSubmission(formData);

  if (!state.token) {
    return { status: "invalid_token", token: null };
  }

  if (!isValidPasswordResetSubmission(submission)) {
    return { status: "invalid_data", token: state.token };
  }

  try {
    await resetPasswordWithToken({
      newPassword: submission.password,
      token: state.token,
    });
    return { status: "success", token: state.token };
  } catch (error) {
    return mapResetPasswordError(error, state.token);
  }
}

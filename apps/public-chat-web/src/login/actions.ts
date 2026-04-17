import {
  AuthSubmissionError,
  submitEmailPasswordAuth,
} from "../platform/auth/client";

const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
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
    email: readFormField(formData, "email"),
    password: readFormField(formData, "password"),
  };
}

function isValidEmailPasswordSubmission(input: {
  email: string;
  password: string;
}): boolean {
  return isValidEmail(input.email) && isValidPassword(input.password);
}

function mapLoginError(error: unknown): LoginActionState {
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

  if (error.code === "invalid_data") {
    return { status: "invalid_data" };
  }

  return { status: "failed" };
}

export async function login(
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const submission = readEmailPasswordSubmission(formData);

  if (!isValidEmailPasswordSubmission(submission)) {
    return { status: "invalid_data" };
  }

  try {
    await submitEmailPasswordAuth("sign-in", {
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

  try {
    await submitEmailPasswordAuth("sign-up", {
      email: submission.email,
      name: deriveRegistrationName(submission.email),
      password: submission.password,
    });

    return { status: "success" };
  } catch (error) {
    return mapRegisterError(error);
  }
}

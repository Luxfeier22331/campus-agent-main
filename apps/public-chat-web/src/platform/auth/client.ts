import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export type AuthMode = "sign-in" | "sign-up";

export type AuthFormSubmission = {
  email: string;
  name: string;
  password: string;
};

export type AuthSubmissionErrorCode = "failed" | "invalid_data" | "user_exists";

export type SignOutChatSessionOptions = {
  redirectTo?: string;
};

type ClientAuthResponse = {
  error?: {
    message?: string;
  } | null;
};

export class AuthSubmissionError extends Error {
  constructor(
    readonly code: AuthSubmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthSubmissionError";
  }
}

function readAuthErrorMessage(response: ClientAuthResponse | undefined, fallback: string): string {
  const message = response?.error?.message?.trim();
  return message || fallback;
}

function classifyAuthSubmissionError(
  mode: AuthMode,
  message: string,
): AuthSubmissionErrorCode {
  if (mode === "sign-up" && /already exists|user exists|account exists/i.test(message)) {
    return "user_exists";
  }

  if (
    /invalid submission|validation|must be at least|required|invalid email|password must|too short/i.test(
      message,
    )
  ) {
    return "invalid_data";
  }

  return "failed";
}

export async function submitEmailPasswordAuth(
  mode: AuthMode,
  values: AuthFormSubmission,
): Promise<void> {
  const response =
    mode === "sign-up"
      ? await authClient.signUp.email({
          callbackURL: "/chat",
          email: values.email,
          name: values.name,
          password: values.password,
        })
      : await authClient.signIn.email({
          callbackURL: "/chat",
          email: values.email,
          password: values.password,
          rememberMe: true,
        });

  if (response?.error) {
    const message = readAuthErrorMessage(response, "Authentication request failed.");
    throw new AuthSubmissionError(classifyAuthSubmissionError(mode, message), message);
  }
}

export async function signOutChatSession(
  options: SignOutChatSessionOptions = {},
): Promise<void> {
  const { redirectTo } = options;
  const response = await authClient.signOut({
    fetchOptions: redirectTo
      ? {
          onSuccess() {
            window.location.assign(redirectTo);
          },
        }
      : undefined,
  });
  if (response?.error) {
    throw new Error(readAuthErrorMessage(response, "Unable to sign out."));
  }
}

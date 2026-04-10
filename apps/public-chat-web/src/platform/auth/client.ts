import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export type AuthMode = "sign-in" | "sign-up";

export type AuthFormState = {
  email: string;
  name: string;
  password: string;
};

export type SignOutChatSessionOptions = {
  redirectTo?: string;
};

type ClientAuthResponse = {
  error?: {
    message?: string;
  } | null;
};

function readAuthErrorMessage(response: ClientAuthResponse | undefined, fallback: string): string {
  const message = response?.error?.message?.trim();
  return message || fallback;
}

export async function submitEmailPasswordAuth(
  mode: AuthMode,
  values: AuthFormState,
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
    throw new Error(readAuthErrorMessage(response, "Authentication request failed."));
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

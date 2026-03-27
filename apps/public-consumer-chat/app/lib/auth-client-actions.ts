import { authClient } from "./auth-client";

export type AuthMode = "sign-in" | "sign-up";

export type AuthFormState = {
  email: string;
  name: string;
  password: string;
};

type ClientAuthResponse = {
  error?: {
    message?: string;
  } | null;
};

const DEFAULT_AUTH_ERROR = "Authentication request failed.";

const readAuthErrorMessage = (
  response: ClientAuthResponse | undefined,
  fallback: string,
): string => {
  const errorMessage = response?.error?.message?.trim();
  return errorMessage || fallback;
};

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
    throw new Error(readAuthErrorMessage(response, DEFAULT_AUTH_ERROR));
  }
}

export async function signOutAppSession(): Promise<void> {
  const response = await authClient.signOut();
  if (response?.error) {
    throw new Error(readAuthErrorMessage(response, "Unable to sign out."));
  }
}

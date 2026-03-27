import { FormEvent, useMemo, useState } from "react";

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { AuthForm } from "../components/chat/auth-form";
import { AuthPreview } from "../components/chat/auth-preview";
import { submitEmailPasswordAuth } from "../lib/auth-client-actions";
import { SparklesIcon } from "../components/chat/chat-icons";
import { SubmitButton } from "../components/chat/submit-button";

export const Route = createFileRoute("/login")({
  loader: async () => {
    try {
      return await loadLoginPage();
    } catch (error) {
      if (isAuthenticatedAppUserRedirectError(error)) {
        throw redirect({
          to: "/chat",
        });
      }

      throw error;
    }
  },
  component: LoginPage,
});

type AuthMode = "sign-in" | "sign-up";
type AuthFormState = {
  email: string;
  name: string;
  password: string;
};

const AUTH_MODE_COPY: Record<
  AuthMode,
  {
    action: string;
    description: string;
    footerAction: string;
    footerPrompt: string;
    title: string;
  }
> = {
  "sign-in": {
    action: "Sign in",
    description: "Sign in to your account to continue.",
    footerAction: "Sign up",
    footerPrompt: "No account?",
    title: "Welcome back",
  },
  "sign-up": {
    action: "Sign up",
    description: "Create an account to keep your chat history.",
    footerAction: "Sign in",
    footerPrompt: "Have an account?",
    title: "Create account",
  },
};

const isAuthenticatedAppUserRedirectError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AuthenticatedAppUserRedirectError";

const loadLoginPage = createServerFn({ method: "GET" }).handler(async () => {
  const { loadLoginPageData } = await import("../lib/login-boundary.server");
  return loadLoginPageData({
    request: getRequest(),
  });
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AuthFormState>({
    email: "",
    name: "",
    password: "",
  });
  const copy = useMemo(() => AUTH_MODE_COPY[mode], [mode]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await submitEmailPasswordAuth(mode, form);
      await navigate({
        to: "/chat",
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "We could not complete that request.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-pane">
        <Link className="auth-back-link" to="/">
          <span aria-hidden="true">←</span>
          Back
        </Link>

        <div className="auth-pane-center">
          <div className="auth-panel">
            <div className="auth-panel-mark" aria-hidden="true">
              <SparklesIcon />
            </div>

            <div className="auth-copy-block">
              <h1 id="login-title">{copy.title}</h1>
              <p className="auth-copy-lede">{copy.description}</p>
            </div>

            <div className="auth-mode-switch" role="tablist" aria-label="Auth mode">
              <button
                aria-selected={mode === "sign-in"}
                className="auth-mode-button"
                onClick={() => setMode("sign-in")}
                role="tab"
                type="button"
              >
                Sign in
              </button>
              <button
                aria-selected={mode === "sign-up"}
                className="auth-mode-button"
                onClick={() => setMode("sign-up")}
                role="tab"
                type="button"
              >
                Sign up
              </button>
            </div>

            <AuthForm
              action={onSubmit}
              defaultEmail={form.email}
              defaultName={form.name}
              email={form.email}
              mode={mode}
              name={form.name}
              onEmailChange={(value) =>
                setForm((current) => ({
                  ...current,
                  email: value,
                }))
              }
              onNameChange={(value) =>
                setForm((current) => ({
                  ...current,
                  name: value,
                }))
              }
              onPasswordChange={(value) =>
                setForm((current) => ({
                  ...current,
                  password: value,
                }))
              }
              password={form.password}
            >
              <SubmitButton pending={pending}>{copy.action}</SubmitButton>
              <p className="auth-footer-copy">
                {copy.footerPrompt}{" "}
                <button
                  className="auth-footer-link"
                  onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
                  type="button"
                >
                  {copy.footerAction}
                </button>
              </p>
            </AuthForm>

            {error ? (
              <p className="route-hint auth-feedback" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="auth-preview-pane" aria-hidden="true">
        <div className="auth-preview-powered">
          <span>Powered by</span>
          <span className="auth-preview-powered-brand">Campus Agent</span>
        </div>

        <AuthPreview />
      </aside>
    </main>
  );
}

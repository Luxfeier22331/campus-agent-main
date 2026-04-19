"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { AuthTurnstileField } from "@platform/auth/turnstile";

import { type LoginActionState, login } from "./actions";

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" },
  );
  const { status, update: updateSession } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      void router.replace("/chat");
    }
  }, [router, status]);

  useEffect(() => {
    if (state.status === "failed") {
      toast({ type: "error", description: "Invalid credentials!" });
      return;
    }

    if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "Failed validating your submission!",
      });
      return;
    }

    if (state.status === "captcha_required") {
      toast({
        type: "error",
        description: "Complete the security verification and try again.",
      });
      return;
    }

    if (state.status === "success") {
      setIsSuccessful(true);
      void (async () => {
        await updateSession();
        await router.replace("/chat");
      })();
    }
  }, [router, state.status, updateSession]);

  const handleSubmit = (formData: FormData) => {
    setIsSuccessful(false);
    setEmail(String(formData.get("email") ?? ""));
    formAction(formData);
  };

  return (
    <AuthLayout>
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground/70">
        Campus Agent
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Sign in with your campus email to continue your conversations, saved
        history, and verified campus guidance.
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <AuthTurnstileField action="sign-in" />
        <div
          className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[13px]"
          data-slot="auth-recovery-cta"
        >
          <span className="text-muted-foreground">Need password help?</span>
          <Link
            className="font-medium text-foreground underline-offset-4 hover:underline"
            href="/forgot-password"
          >
            Reset password
          </Link>
        </div>
        <SubmitButton isSuccessful={isSuccessful}>Sign in</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"No account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/register"
          >
            Sign up
          </Link>
        </p>
      </AuthForm>
    </AuthLayout>
  );
}

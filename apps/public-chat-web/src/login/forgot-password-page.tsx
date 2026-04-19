"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { AuthTurnstileField } from "@platform/auth/turnstile";

import {
  type PasswordRecoveryActionState,
  requestPasswordRecovery,
} from "./actions";
import { PasswordRecoveryRequestForm } from "./recovery-form";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, formAction] = useActionState<
    PasswordRecoveryActionState,
    FormData
  >(requestPasswordRecovery, {
    status: "idle",
  });

  useEffect(() => {
    if (state.status === "failed") {
      toast({
        type: "error",
        description: "We couldn't start password recovery. Please try again.",
      });
      return;
    }

    if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "Enter a valid campus email address.",
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
      toast({
        type: "success",
        description:
          "If an account exists for that email, a reset link is on the way.",
      });
    }
  }, [state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(String(formData.get("email") ?? ""));
    formAction(formData);
  };

  return (
    <AuthLayout>
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground/70">
        Campus Agent
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Enter your campus email and we&apos;ll send a reset link if the account
        is eligible for recovery.
      </p>
      <PasswordRecoveryRequestForm action={handleSubmit} defaultEmail={email}>
        <AuthTurnstileField action="request-password-reset" />
        <p className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
          We&apos;ll only ever send recovery back into this public auth flow.
        </p>
        {state.status === "success" ? (
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-950">
            If an account exists for <span className="font-medium">{email}</span>
            , check your inbox for the reset link.
          </p>
        ) : null}
        <SubmitButton isSuccessful={false}>Send reset link</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Remembered it? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Back to sign in
          </Link>
        </p>
      </PasswordRecoveryRequestForm>
    </AuthLayout>
  );
}

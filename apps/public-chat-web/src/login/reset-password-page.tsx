"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

import { type ResetPasswordActionState, resetPassword } from "./actions";
import { PasswordRecoveryResetForm } from "./recovery-form";

function resolveResetPasswordInitialState(): ResetPasswordActionState {
  if (typeof window === "undefined") {
    return { status: "idle", token: null };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token")?.trim() || null;
  const error = searchParams.get("error");

  if (!token || error === "INVALID_TOKEN") {
    return { status: "invalid_token", token: null };
  }

  return { status: "idle", token };
}

export function ResetPasswordPage() {
  const router = useRouter();
  const initialState = useMemo(resolveResetPasswordInitialState, []);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<ResetPasswordActionState, FormData>(
    resetPassword,
    initialState,
  );

  useEffect(() => {
    if (state.status === "failed") {
      toast({
        type: "error",
        description: "We couldn't reset your password. Please try again.",
      });
      return;
    }

    if (state.status === "invalid_data") {
      toast({
        type: "error",
        description:
          "Use a password that is at least 10 characters and matches both fields.",
      });
      return;
    }

    if (state.status === "success") {
      setIsSuccessful(true);
      toast({
        type: "success",
        description: "Password updated. Sign in with your new password.",
      });
      void router.replace("/login");
    }
  }, [router, state.status]);

  const handleSubmit = (formData: FormData) => {
    setIsSuccessful(false);
    formAction(formData);
  };

  return (
    <AuthLayout>
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground/70">
        Campus Agent
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Choose a new password for your campus account and then return to sign
        in.
      </p>
      {state.status === "invalid_token" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-muted/30 p-4">
          <p className="text-sm text-foreground">
            This reset link is invalid or has expired. Request a fresh recovery
            email to continue.
          </p>
          <div className="flex flex-wrap gap-3 text-[13px] text-muted-foreground">
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/forgot-password"
            >
              Request a new reset link
            </Link>
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/login"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <PasswordRecoveryResetForm action={handleSubmit}>
          <p className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
            Your new password must be at least 10 characters and will replace
            every previous session.
          </p>
          <SubmitButton isSuccessful={isSuccessful}>Save new password</SubmitButton>
          <p className="text-center text-[13px] text-muted-foreground">
            {"Need another link? "}
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/forgot-password"
            >
              Start recovery again
            </Link>
          </p>
        </PasswordRecoveryResetForm>
      )}
    </AuthLayout>
  );
}

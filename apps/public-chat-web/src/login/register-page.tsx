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

import { type RegisterActionState, register } from "./actions";

export function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" },
  );
  const { status, update: updateSession } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      void router.replace("/chat");
    }
  }, [router, status]);

  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ type: "error", description: "Account already exists!" });
      return;
    }

    if (state.status === "failed") {
      toast({ type: "error", description: "Failed to create account!" });
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
      toast({ type: "success", description: "Account created!" });
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
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Create your campus account to keep chat history, signed-in access, and
        request tracking in one place.
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <AuthTurnstileField action="sign-up" />
        <p className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
          Use the same campus email you expect to use for protected answers and
          future recovery.
        </p>
        <SubmitButton isSuccessful={isSuccessful}>Sign up</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Have an account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </AuthForm>
    </AuthLayout>
  );
}

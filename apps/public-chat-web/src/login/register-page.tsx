"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

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
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="text-sm text-muted-foreground">Get started for free</p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
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

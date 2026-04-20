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
        description: "暂时无法更新密码，请稍后重试。",
      });
      return;
    }

    if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "请使用至少 10 位的新密码，并确保两次输入一致。",
      });
      return;
    }

    if (state.status === "success") {
      setIsSuccessful(true);
      toast({
        type: "success",
        description: "密码已更新，请重新登录。",
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
      <h1 className="text-2xl font-semibold tracking-tight">设置新密码</h1>
      <p className="text-sm text-muted-foreground">设置完成后，请使用新密码重新登录。</p>
      {state.status === "invalid_token" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            当前链接已失效，请重新申请密码重置邮件。
          </p>
          <div className="text-center text-[13px] text-muted-foreground">
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/forgot-password"
            >
              重新发送重置邮件
            </Link>
            {" · "}
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/login"
            >
              返回登录
            </Link>
          </div>
        </div>
      ) : (
        <PasswordRecoveryResetForm action={handleSubmit}>
          <SubmitButton isSuccessful={isSuccessful}>更新密码</SubmitButton>
          <p className="text-center text-[13px] text-muted-foreground">
            {"还需要新的重置邮件？"}
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href="/forgot-password"
            >
              重新开始找回
            </Link>
          </p>
        </PasswordRecoveryResetForm>
      )}
    </AuthLayout>
  );
}

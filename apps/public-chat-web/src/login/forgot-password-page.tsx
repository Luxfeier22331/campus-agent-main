"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

import { type PasswordRecoveryActionState, requestPasswordRecovery } from "./actions";
import { PasswordRecoveryRequestForm } from "./recovery-form";

export function ForgotPasswordPage() {
	const [email, setEmail] = useState("");
	const [state, formAction] = useActionState<PasswordRecoveryActionState, FormData>(
		requestPasswordRecovery,
		{
			status: "idle",
		},
	);

	useEffect(() => {
		if (state.status === "failed") {
			toast({
				type: "error",
				description: "暂时无法发送重置邮件，请稍后重试。",
			});
			return;
		}

		if (state.status === "invalid_data") {
			toast({
				type: "error",
				description: "请输入有效的校园邮箱地址。",
			});
			return;
		}

		if (state.status === "captcha_required") {
			toast({
				type: "error",
				description: "请先完成安全验证。",
			});
			return;
		}

		if (state.status === "success") {
			toast({
				type: "success",
				description: "如果该邮箱已关联账号，系统会发送一封重置邮件。",
			});
		}
	}, [state.status]);

	const handleSubmit = (formData: FormData) => {
		setEmail(String(formData.get("email") ?? ""));
		formAction(formData);
	};

	return (
		<AuthLayout>
			<h1 className="text-2xl font-semibold tracking-tight">找回密码</h1>
			<p className="text-sm text-muted-foreground">输入注册邮箱后，我们会发送重置邮件。</p>
			<PasswordRecoveryRequestForm action={handleSubmit} defaultEmail={email}>
				{state.status === "success" ? (
					<p className="text-center text-[13px] text-muted-foreground">
						如果该邮箱已关联账号，重置邮件将发送至
						<span className="font-medium">{email}</span>。
					</p>
				) : null}
				<SubmitButton isSuccessful={false}>发送重置邮件</SubmitButton>
				<p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-[13px] text-muted-foreground">
					<span>想起密码了？</span>
					<Link
						className="inline-flex min-h-10 items-center rounded-md px-1 text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
						href="/login"
					>
						去登录
					</Link>
				</p>
			</PasswordRecoveryRequestForm>
		</AuthLayout>
	);
}

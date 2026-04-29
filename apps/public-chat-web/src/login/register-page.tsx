"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
	const [state, formAction] = useActionState<RegisterActionState, FormData>(register, {
		status: "idle",
	});

	useEffect(() => {
		if (state.status === "user_exists") {
			toast({ type: "error", description: "该邮箱已注册，请直接登录。" });
			return;
		}

		if (state.status === "failed") {
			toast({ type: "error", description: "暂时无法完成注册，请稍后重试。" });
			return;
		}

		if (state.status === "invalid_data") {
			toast({
				type: "error",
				description: "请填写有效的校园邮箱和密码。",
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
			setIsSuccessful(true);
			toast({ type: "success", description: "注册成功，正在进入校园助理。" });
			void router.replace("/chat");
		}
	}, [router, state.status]);

	const handleSubmit = (formData: FormData) => {
		setIsSuccessful(false);
		setEmail(String(formData.get("email") ?? ""));
		formAction(formData);
	};

	return (
		<AuthLayout>
			<h1 className="text-2xl font-semibold tracking-tight">注册</h1>
			<p className="text-sm text-muted-foreground">使用校园邮箱创建账号</p>
			<AuthForm action={handleSubmit} defaultEmail={email}>
				<SubmitButton isSuccessful={isSuccessful}>注册</SubmitButton>
				<p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-[13px] text-muted-foreground">
					<span>已有账号？</span>
					<Link
						className="inline-flex min-h-10 items-center rounded-md px-1 text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
						href="/login"
					>
						去登录
					</Link>
				</p>
			</AuthForm>
		</AuthLayout>
	);
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import AuthLayout from "@/app/(auth)/layout";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

import { type LoginActionState, login } from "./actions";

export function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [isSuccessful, setIsSuccessful] = useState(false);
	const [state, formAction] = useActionState<LoginActionState, FormData>(login, { status: "idle" });

	useEffect(() => {
		if (state.status === "failed") {
			toast({ type: "error", description: "邮箱或密码不正确，请重新输入。" });
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
			<h1 className="text-2xl font-semibold tracking-tight">登录</h1>
			<p className="text-sm text-muted-foreground">继续查看历史对话与提问记录</p>
			<AuthForm action={handleSubmit} defaultEmail={email}>
				<SubmitButton isSuccessful={isSuccessful}>登录</SubmitButton>
				<p className="text-center text-[13px] text-muted-foreground">
					{"还没有账号？"}
					<Link className="text-foreground underline-offset-4 hover:underline" href="/register">
						注册
					</Link>
					{" · "}
					<Link
						className="text-foreground underline-offset-4 hover:underline"
						href="/forgot-password"
					>
						忘记密码？
					</Link>
				</p>
			</AuthForm>
		</AuthLayout>
	);
}

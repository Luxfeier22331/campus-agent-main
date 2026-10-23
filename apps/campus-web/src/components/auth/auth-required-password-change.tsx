import { Button, FieldGroup } from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
	campusAuthClient,
	readCampusAuthErrorMessage,
	throwCampusAuthResultError,
} from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";
import { type ChangePasswordValues, changePasswordSchema } from "./auth-email-validation";
import { authRetryAfterMessage, useAuthRetryAfter } from "./auth-form-retry";
import { AuthFormError, AuthFormFrame, PasswordField } from "./auth-form-support";

export function RequiredPasswordChange({
	onComplete,
	onSignedOut,
}: {
	onComplete: () => void;
	onSignedOut: () => void;
}) {
	const session = useCampusSession();
	const [signingOut, setSigningOut] = useState(false);
	const retryAfter = useAuthRetryAfter();
	const form = useForm<ChangePasswordValues>({
		defaultValues: { confirmPassword: "", currentPassword: "", newPassword: "" },
		resolver: zodResolver(changePasswordSchema),
	});

	async function submit(values: ChangePasswordValues) {
		form.clearErrors("root");
		try {
			const result = await campusAuthClient.changePassword(
				{
					currentPassword: values.currentPassword,
					newPassword: values.newPassword,
					revokeOtherSessions: true,
				},
				{ throw: true },
			);
			if (result && typeof result === "object" && "error" in result && result.error) {
				throwCampusAuthResultError(result);
			}
			await session.refresh();
			onComplete();
		} catch (error) {
			if (!retryAfter.start(error)) {
				form.setError("root", { message: readCampusAuthErrorMessage(error) });
			}
		}
	}

	async function signOut() {
		setSigningOut(true);
		form.clearErrors("root");
		try {
			await campusAuthClient.signOut({ fetchOptions: { throw: true } });
			await session.refresh();
			onSignedOut();
		} catch {
			form.setError("root", { message: "退出失败，你仍保持登录状态。请稍后重试。" });
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<AuthFormFrame
			description="当前账号使用了临时密码。修改后会退出其他设备，并恢复全部功能。"
			footer={
				<Button
					className="w-full"
					disabled={signingOut}
					onClick={() => void signOut()}
					variant="ghost"
				>
					<LogOut />
					{signingOut ? "正在退出" : "退出登录"}
				</Button>
			}
			title="请先修改密码"
		>
			<form className="space-y-5" noValidate onSubmit={form.handleSubmit(submit)}>
				<FieldGroup>
					<PasswordField
						autoComplete="current-password"
						error={form.formState.errors.currentPassword?.message}
						label="当前密码"
						registration={form.register("currentPassword")}
					/>
					<PasswordField
						autoComplete="new-password"
						description="可使用字母、数字、空格和符号。"
						error={form.formState.errors.newPassword?.message}
						label="新密码"
						registration={form.register("newPassword")}
					/>
					<PasswordField
						autoComplete="new-password"
						error={form.formState.errors.confirmPassword?.message}
						label="确认新密码"
						registration={form.register("confirmPassword")}
					/>
				</FieldGroup>
				<AuthFormError
					message={
						authRetryAfterMessage(retryAfter.secondsRemaining) ??
						form.formState.errors.root?.message
					}
				/>
				<Button
					className="w-full"
					disabled={form.formState.isSubmitting || retryAfter.secondsRemaining > 0}
					size="lg"
					type="submit"
				>
					{form.formState.isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
					{form.formState.isSubmitting
						? "正在修改"
						: retryAfter.secondsRemaining > 0
							? `${retryAfter.secondsRemaining} 秒后重试`
							: "修改密码"}
				</Button>
			</form>
		</AuthFormFrame>
	);
}

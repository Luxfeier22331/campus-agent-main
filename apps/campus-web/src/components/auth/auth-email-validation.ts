import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { z } from "zod";

export const emailSchema = z.object({
	email: z.string().trim().email("请输入有效的邮箱地址。"),
});

export const resetPasswordSchema = z
	.object({
		confirmPassword: z.string(),
		password: z
			.string()
			.min(CAMPUS_PASSWORD_MIN_LENGTH, `密码至少需要 ${CAMPUS_PASSWORD_MIN_LENGTH} 个字符。`)
			.max(CAMPUS_PASSWORD_MAX_LENGTH, `密码不能超过 ${CAMPUS_PASSWORD_MAX_LENGTH} 个字符。`),
	})
	.refine((values) => values.password === values.confirmPassword, {
		message: "两次输入的密码不一致。",
		path: ["confirmPassword"],
	});

export const changePasswordSchema = z
	.object({
		confirmPassword: z.string(),
		currentPassword: z.string().min(1, "请输入当前密码。"),
		newPassword: z
			.string()
			.min(CAMPUS_PASSWORD_MIN_LENGTH, `密码至少需要 ${CAMPUS_PASSWORD_MIN_LENGTH} 个字符。`)
			.max(CAMPUS_PASSWORD_MAX_LENGTH, `密码不能超过 ${CAMPUS_PASSWORD_MAX_LENGTH} 个字符。`),
	})
	.refine((values) => values.newPassword === values.confirmPassword, {
		message: "两次输入的新密码不一致。",
		path: ["confirmPassword"],
	});

export type EmailValues = z.infer<typeof emailSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

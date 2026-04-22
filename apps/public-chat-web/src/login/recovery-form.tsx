import { type AuthTurnstileController, AuthTurnstileField } from "@platform/auth/turnstile";

import Form from "next/form";
import { type FormEvent, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELD_CLASS_NAME =
	"h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted";

export function PasswordRecoveryRequestForm(props: {
	action: NonNullable<string | ((formData: FormData) => void | Promise<void>) | undefined>;
	children: React.ReactNode;
	defaultEmail?: string;
}) {
	const { action, children, defaultEmail = "" } = props;
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);
	const allowingTurnstileSubmitRef = useRef(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		if (allowingTurnstileSubmitRef.current) {
			return;
		}

		const form = event.currentTarget;
		const tokenField = form.elements.namedItem("captchaToken");
		const existingToken = tokenField instanceof HTMLInputElement ? tokenField.value.trim() : "";

		if (existingToken) {
			return;
		}

		event.preventDefault();

		const didResolve = await turnstileControllerRef.current?.ensureToken?.();
		if (!didResolve) {
			return;
		}

		allowingTurnstileSubmitRef.current = true;
		try {
			const nativeSubmitEvent = event.nativeEvent;
			const submitter =
				nativeSubmitEvent instanceof SubmitEvent ? nativeSubmitEvent.submitter : null;
			if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
				form.requestSubmit(submitter);
				return;
			}

			form.requestSubmit();
		} finally {
			allowingTurnstileSubmitRef.current = false;
		}
	};

	return (
		<Form action={action} className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-2">
				<Label className="font-normal text-muted-foreground" htmlFor="email">
					邮箱
				</Label>
				<Input
					autoComplete="email"
					autoFocus
					className={FIELD_CLASS_NAME}
					defaultValue={defaultEmail}
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</div>

			<AuthTurnstileField
				action="request-password-reset"
				onController={(controller) => {
					turnstileControllerRef.current = controller;
				}}
			/>

			{children}
		</Form>
	);
}

export function PasswordRecoveryResetForm(props: {
	action: NonNullable<string | ((formData: FormData) => void | Promise<void>) | undefined>;
	children: React.ReactNode;
}) {
	const { action, children } = props;

	return (
		<Form action={action} className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label className="font-normal text-muted-foreground" htmlFor="password">
					新密码
				</Label>
				<Input
					autoComplete="new-password"
					autoFocus
					className={FIELD_CLASS_NAME}
					id="password"
					name="password"
					placeholder="请输入新密码"
					required
					type="password"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label className="font-normal text-muted-foreground" htmlFor="confirmPassword">
					确认密码
				</Label>
				<Input
					autoComplete="new-password"
					className={FIELD_CLASS_NAME}
					id="confirmPassword"
					name="confirmPassword"
					placeholder="再次输入新密码"
					required
					type="password"
				/>
			</div>

			{children}
		</Form>
	);
}

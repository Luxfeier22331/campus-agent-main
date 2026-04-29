import { type AuthTurnstileController, AuthTurnstileField } from "@platform/auth/turnstile";

import Form from "next/form";
import { usePathname } from "next/navigation";
import { type FormEvent, type ReactNode, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function resolveTurnstileAction(pathname: string) {
	if (pathname === "/login") {
		return "sign-in" as const;
	}

	if (pathname === "/register") {
		return "sign-up" as const;
	}

	return null;
}

function resolvePasswordAutocomplete(pathname: string) {
	return pathname === "/login" ? "current-password" : "new-password";
}

export function AuthForm({
	action,
	children,
	defaultEmail = "",
}: {
	action: NonNullable<string | ((formData: FormData) => void | Promise<void>) | undefined>;
	children: ReactNode;
	defaultEmail?: string;
}) {
	const pathname = usePathname();
	const turnstileAction = resolveTurnstileAction(pathname);
	const passwordAutocomplete = resolvePasswordAutocomplete(pathname);
	const turnstileControllerRef = useRef<AuthTurnstileController | null>(null);
	const allowingTurnstileSubmitRef = useRef(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		if (!turnstileAction || allowingTurnstileSubmitRef.current) {
			return;
		}

		const form = event.currentTarget;
		const tokenField = form.elements.namedItem("captchaToken");
		const existingToken = tokenField instanceof HTMLInputElement ? tokenField.value.trim() : "";

		if (existingToken) {
			turnstileControllerRef.current?.resetToken();
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
					className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
					defaultValue={defaultEmail}
					id="email"
					name="email"
					placeholder="name@muc.edu.cn"
					required
					type="email"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label className="font-normal text-muted-foreground" htmlFor="password">
					密码
				</Label>
				<Input
					autoComplete={passwordAutocomplete}
					className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
					id="password"
					name="password"
					placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
					required
					type="password"
				/>
			</div>

			{turnstileAction ? (
				<AuthTurnstileField
					action={turnstileAction}
					onController={(controller) => {
						turnstileControllerRef.current = controller;
					}}
				/>
			) : null}
			{children}
		</Form>
	);
}

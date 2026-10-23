import { Alert, AlertDescription, Button, Field, focusRing, Input } from "@campus-agent/ui";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { useForm } from "react-hook-form";

import type { AuthFormFrameProps } from "./auth-form-contract";

export function AuthFormFrame({ children, description, footer, title }: AuthFormFrameProps) {
	return (
		<div className="w-full">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold text-[var(--sys-text-strong)]">{title}</h1>
				<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)] [overflow-wrap:anywhere]">
					{description}
				</p>
			</header>
			{children}
			{footer ? <div className="mt-6 border-t pt-5">{footer}</div> : null}
		</div>
	);
}

export function AuthFormError({ message }: { message?: string | undefined }) {
	if (!message) {
		return null;
	}
	return (
		<Alert tone="danger">
			<CircleAlert aria-hidden="true" />
			<h2 className="mb-1 font-semibold leading-none">操作未完成</h2>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

export function PasswordField({
	autoComplete,
	description,
	error,
	label,
	registration,
}: {
	autoComplete: string;
	description?: string;
	error?: string | undefined;
	label: string;
	registration: ReturnType<ReturnType<typeof useForm>["register"]>;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<Field
			action={
				<Button
					aria-label={visible ? "隐藏密码" : "显示密码"}
					className="mr-0.5"
					onClick={() => setVisible((value) => !value)}
					size="icon"
					variant="ghost"
				>
					{visible ? <EyeOff /> : <Eye />}
				</Button>
			}
			description={description}
			error={error}
			label={label}
		>
			<Input
				autoComplete={autoComplete}
				className="pr-14"
				required
				type={visible ? "text" : "password"}
				{...registration}
			/>
		</Field>
	);
}

export function AuthTextAction({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			className={`font-medium text-link underline-offset-4 hover:text-link-hover hover:underline ${focusRing}`}
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

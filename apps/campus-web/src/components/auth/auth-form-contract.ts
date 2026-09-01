import type { ReactNode } from "react";

export type AuthFormView = "forgotPassword" | "signIn" | "signUp";

export interface VerificationDeliveryFailure {
	retryAfterSeconds?: number;
}

export interface SharedAuthFormProps {
	onAuthenticated: () => void | Promise<void>;
	onSwitch: (view: AuthFormView) => void;
	onVerificationRequired: (email: string, failure?: VerificationDeliveryFailure) => void;
	redirectTo: string;
}

export interface AuthFormFrameProps {
	children: ReactNode;
	description: string;
	footer?: ReactNode;
	title: string;
}

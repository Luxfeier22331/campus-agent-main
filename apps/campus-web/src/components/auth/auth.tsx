import { AuthView, type AuthViewPaths } from "better-auth-ui";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
	setSignupLegalConsentAccepted,
} from "@/platform/auth/legal-consent";

export type CampusAuthView = keyof AuthViewPaths;

export function Auth({ view }: { view?: CampusAuthView }) {
	const isSignUp = view === "SIGN_UP";
	const [signupConsentAccepted, setSignupConsentAcceptedState] = useState(false);

	useEffect(() => {
		if (!isSignUp) {
			setSignupLegalConsentAccepted(false);
		}
		return () => {
			if (isSignUp) {
				setSignupLegalConsentAccepted(false);
			}
		};
	}, [isSignUp]);

	return (
		<section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center px-5 py-10">
			<div className="w-full">
				{isSignUp ? (
					<SignupConsentGate
						accepted={signupConsentAccepted}
						onAcceptedChange={setSignupConsentAcceptedState}
					/>
				) : null}
				{!isSignUp || signupConsentAccepted ? (
					<AuthView
						className={cn(
							"mx-auto w-full rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]",
							isSignUp && "mt-4",
						)}
						view={view}
					/>
				) : null}
			</div>
		</section>
	);
}

function SignupConsentGate({
	accepted,
	onAcceptedChange,
}: {
	accepted: boolean;
	onAcceptedChange: (accepted: boolean) => void;
}) {
	const consentId = "signup-legal-consent";

	useEffect(() => {
		setSignupLegalConsentAccepted(accepted);
	}, [accepted]);

	return (
		<Card className="rounded-lg">
			<CardContent className="p-4">
				<div className="flex items-start gap-3 text-sm leading-6">
					<Checkbox
						checked={accepted}
						className="mt-1"
						id={consentId}
						onCheckedChange={(checked) => onAcceptedChange(checked === true)}
					/>
					<label htmlFor={consentId}>
						我已阅读并同意
						<a className="mx-1 font-medium text-primary hover:text-primary/80" href="/legal/terms">
							用户服务协议
						</a>
						和
						<a
							className="mx-1 font-medium text-primary hover:text-primary/80"
							href="/legal/privacy"
						>
							隐私政策
						</a>
						。
					</label>
				</div>
				{accepted ? null : (
					<p className="mt-3 text-muted-foreground text-xs">
						{SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE}
					</p>
				)}
				<Button
					aria-hidden="true"
					className={cn("mt-3 w-full", accepted && "hidden")}
					disabled
					tabIndex={-1}
					type="button"
				>
					注册
				</Button>
			</CardContent>
		</Card>
	);
}

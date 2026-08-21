import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	type CampusAuthResultState,
	readCampusAuthResultState,
} from "@/platform/auth/result-state";
import { buildAuthViewHref, resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import { useCampusSession } from "@/platform/auth/session";
import {
	ForgotPasswordForm,
	RequiredPasswordChange,
	ResetComplete,
	ResetLinkSent,
	ResetPasswordForm,
	VerificationPending,
	VerificationResult,
} from "./auth-email-flows";
import {
	type AuthFormView,
	SignInForm,
	SignUpForm,
	type VerificationDeliveryFailure,
} from "./auth-forms";

export type CampusAuthView =
	| "changePassword"
	| "forgotPassword"
	| "resetComplete"
	| "resetLinkSent"
	| "resetPassword"
	| "signIn"
	| "signUp"
	| "verifyEmail"
	| "verifyEmailResult";

export interface CampusAuthPresentationCopy {
	signUpPasswordDescription?: string | undefined;
}

export function AuthPanel({
	className = "mx-auto w-full max-w-sm",
	localNavigation = false,
	onAuthenticated,
	presentationCopy,
	redirectTo: redirectToOverride,
	view = "signIn",
}: {
	className?: string;
	localNavigation?: boolean;
	onAuthenticated?: () => void;
	presentationCopy?: CampusAuthPresentationCopy | undefined;
	redirectTo?: string;
	view?: CampusAuthView;
}) {
	const navigate = useNavigate();
	const location = useLocation();
	const session = useCampusSession();
	const [localView, setLocalView] = useState<CampusAuthView>(view);
	const [localEmail, setLocalEmail] = useState("");
	const [localVerificationDeliveryStatus, setLocalVerificationDeliveryStatus] = useState<
		"failed" | "sent"
	>();
	const [localVerificationRetryAfterSeconds, setLocalVerificationRetryAfterSeconds] = useState(0);
	const activeView = localNavigation ? localView : view;
	const authResult = readCampusAuthResultState(location.state.campusAuthResult);
	const search = readSearch();
	const redirectSearch = redirectToOverride
		? new URLSearchParams({ redirectTo: redirectToOverride })
		: search;
	const redirectTo = resolveAccountAuthReturnTarget(redirectSearch, {
		...(typeof window === "undefined" ? {} : { currentOrigin: window.location.origin }),
	});
	const invitationEmail = normalizeOptionalEmail(search.get("email"));

	useEffect(() => {
		if (localNavigation) {
			setLocalView(view);
		}
	}, [localNavigation, view]);

	function switchView(nextView: AuthFormView) {
		if (localNavigation) {
			setLocalView(nextView);
			return;
		}
		const routeView =
			nextView === "signIn" ? "login" : nextView === "signUp" ? "register" : "forgotPassword";
		void navigate({
			to: buildAuthViewHref(routeView, {
				...(typeof window === "undefined" ? {} : { currentOrigin: window.location.origin }),
				redirectTo,
			}),
		});
	}

	function showVerification(
		email: string,
		deliveryStatus?: "failed" | "sent",
		retryAfterSeconds?: number,
	) {
		if (localNavigation) {
			setLocalEmail(email);
			setLocalVerificationDeliveryStatus(deliveryStatus);
			setLocalVerificationRetryAfterSeconds(retryAfterSeconds ?? 0);
			setLocalView("verifyEmail");
			return;
		}
		void navigate({
			search: { redirectTo },
			...(deliveryStatus
				? {
						state: {
							campusAuthResult: {
								email,
								kind: "verification-delivery",
								...(retryAfterSeconds ? { retryAfterSeconds } : {}),
								status: deliveryStatus,
							} satisfies CampusAuthResultState,
						},
					}
				: {}),
			to: "/account/verify-email",
		});
	}

	function onVerificationRequired(email: string, failure?: VerificationDeliveryFailure) {
		showVerification(email, failure ? "failed" : "sent", failure?.retryAfterSeconds);
	}

	async function completeAuthentication() {
		await session.refresh();
		if (onAuthenticated) {
			onAuthenticated();
			return;
		}
		void navigate({ replace: true, to: redirectTo });
	}

	function showResetLinkSent() {
		if (localNavigation) {
			setLocalView("resetLinkSent");
			return;
		}
		void navigate({
			search: { redirectTo },
			to: "/account/reset-link-sent",
		});
	}

	function showSignIn() {
		switchView("signIn");
	}

	function showForgotPassword() {
		switchView("forgotPassword");
	}

	let content: React.ReactNode;
	if (activeView === "signUp") {
		content = (
			<SignUpForm
				defaultEmail={invitationEmail}
				onAuthenticated={completeAuthentication}
				onSwitch={switchView}
				onVerificationRequired={onVerificationRequired}
				passwordDescription={presentationCopy?.signUpPasswordDescription}
				redirectTo={redirectTo}
			/>
		);
	} else if (activeView === "forgotPassword") {
		content = (
			<ForgotPasswordForm
				onSent={showResetLinkSent}
				onSignIn={showSignIn}
				redirectTo={redirectTo}
			/>
		);
	} else if (activeView === "resetLinkSent") {
		content = <ResetLinkSent onSignIn={showSignIn} />;
	} else if (activeView === "verifyEmail") {
		const deliveryResult = authResult?.kind === "verification-delivery" ? authResult : undefined;
		content = (
			<VerificationPending
				initialDeliveryStatus={
					localNavigation ? localVerificationDeliveryStatus : deliveryResult?.status
				}
				initialEmail={localNavigation ? localEmail : (deliveryResult?.email ?? "")}
				initialRetryAfterSeconds={
					localNavigation
						? localVerificationRetryAfterSeconds
						: (deliveryResult?.retryAfterSeconds ?? 0)
				}
				onSignIn={showSignIn}
				redirectTo={redirectTo}
			/>
		);
	} else if (activeView === "verifyEmailResult") {
		content = (
			<VerificationResult
				errorCode={normalizeOptionalValue(search.get("error"))}
				onContinue={() => void navigate({ replace: true, to: redirectTo })}
				onResend={() => showVerification("")}
				onSignIn={showSignIn}
			/>
		);
	} else if (activeView === "resetPassword") {
		content = (
			<ResetPasswordForm
				initialError={normalizeOptionalValue(search.get("error"))}
				onComplete={() =>
					void navigate({
						replace: true,
						search: { redirectTo },
						state: {
							campusAuthResult: {
								kind: "reset-complete",
							} satisfies CampusAuthResultState,
						},
						to: "/account/reset-complete",
					})
				}
				onRequestNewLink={showForgotPassword}
				token={normalizeOptionalValue(search.get("token"))}
			/>
		);
	} else if (activeView === "resetComplete") {
		content = (
			<ResetComplete confirmed={authResult?.kind === "reset-complete"} onSignIn={showSignIn} />
		);
	} else if (activeView === "changePassword") {
		content = (
			<RequiredPasswordChange
				onComplete={() => void navigate({ replace: true, to: redirectTo })}
				onSignedOut={() =>
					void navigate({
						replace: true,
						to: buildAuthViewHref("login", { redirectTo }),
					})
				}
			/>
		);
	} else {
		content = (
			<SignInForm
				onAuthenticated={completeAuthentication}
				onSwitch={switchView}
				onVerificationRequired={onVerificationRequired}
				redirectTo={redirectTo}
			/>
		);
	}

	return <div className={className}>{content}</div>;
}

export function Auth({
	presentationCopy,
	view,
}: {
	presentationCopy?: CampusAuthPresentationCopy | undefined;
	view?: CampusAuthView | undefined;
}) {
	return (
		<section
			aria-label="account-auth-layout"
			className="flex min-h-[calc(100dvh-var(--layout-campus-topnav-height))] flex-col items-center px-4 pb-10 pt-8 sm:pt-10"
			data-campus-account-surface="auth"
		>
			<AuthPanel {...(presentationCopy ? { presentationCopy } : {})} {...(view ? { view } : {})} />
		</section>
	);
}

function readSearch(): URLSearchParams {
	return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

function normalizeOptionalEmail(value: string | null): string {
	const email = value?.trim().toLowerCase() ?? "";
	return email.length <= 320 && /^[^@\s]+@[^@\s]+$/u.test(email) ? email : "";
}

function normalizeOptionalValue(value: string | null): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

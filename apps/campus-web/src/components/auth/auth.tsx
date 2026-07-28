import type { AuthView } from "@better-auth-ui/core";
import { Auth as BetterAuthHeroUIAuth } from "@better-auth-ui/heroui";
import { useEffect } from "react";

import { ProductBrandLink } from "@/components/navigation/product-navigation";
import { CampusAuthUIProvider } from "./auth-ui-provider";
import "./auth-styles.css";

export type CampusAuthView = AuthView;

export function AuthPanel({
	className = "mx-auto w-full max-w-sm",
	view,
}: {
	className?: string;
	view?: CampusAuthView;
}) {
	return <BetterAuthHeroUIAuth className={className} view={view} />;
}

export function Auth({ view }: { view?: CampusAuthView }) {
	useInvitationEmailPrefill(view);
	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-auth-layout"
				className="flex min-h-dvh flex-col items-center px-4 pb-10 pt-8 sm:pt-10"
				data-campus-account-surface="auth"
			>
				<ProductBrandLink className="mb-8 w-full max-w-sm" />
				<AuthPanel view={view} />
			</section>
		</CampusAuthUIProvider>
	);
}

function useInvitationEmailPrefill(view: CampusAuthView | undefined): void {
	useEffect(() => {
		if (view !== "signUp") {
			return;
		}
		const email = new URLSearchParams(window.location.search).get("email")?.trim().toLowerCase();
		if (!email || email.length > 320 || !/^[^@\s]+@[^@\s]+$/u.test(email)) {
			return;
		}
		let attempts = 0;
		let cancelled = false;
		let timeoutId: number | undefined;
		const prefill = () => {
			if (cancelled) {
				return;
			}
			const field = document.querySelector<HTMLInputElement>(
				'[data-campus-account-surface="auth"] input[type="email"]',
			);
			if (!field && attempts < 20) {
				attempts += 1;
				timeoutId = window.setTimeout(prefill, 50);
				return;
			}
			if (!field || field.value) {
				return;
			}
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(field, email);
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new Event("change", { bubbles: true }));
		};
		prefill();
		return () => {
			cancelled = true;
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [view]);
}

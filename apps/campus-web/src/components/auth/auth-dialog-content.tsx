import { useEffect, useRef } from "react";
import { AuthPanel, type CampusAuthView } from "./auth";

export type AuthDialogView = Extract<CampusAuthView, "signIn" | "signUp">;

export function AuthDialogContent({
	redirectTo,
	onAuthenticated,
	view,
}: {
	onAuthenticated: () => void;
	redirectTo: string;
	view: AuthDialogView;
}) {
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			contentRef.current
				?.querySelector<HTMLInputElement>(
					'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
				)
				?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, []);

	return (
		<div className="w-full" ref={contentRef}>
			<AuthPanel
				className="w-full"
				localNavigation
				onAuthenticated={onAuthenticated}
				redirectTo={redirectTo}
				view={view}
			/>
		</div>
	);
}

import { AuthProvider } from "@better-auth-ui/heroui";
import { ToastProvider } from "@heroui/react";
import type { ReactNode } from "react";

import { createCampusAuthUIProviderProps } from "./auth-ui-provider-config";

function BrowserAuthLink({
	children,
	className,
	href,
}: {
	children: ReactNode;
	className?: string;
	href: string;
}) {
	return (
		<a className={className} href={href}>
			{children}
		</a>
	);
}

export function CampusBrowserAuthUIProvider({
	children,
	enableCaptcha = false,
	redirectTo,
}: {
	children: ReactNode;
	enableCaptcha?: boolean;
	redirectTo?: string;
}) {
	const commonProps = createCampusAuthUIProviderProps({
		authLink: BrowserAuthLink,
		enableCaptcha,
		navigate: ({ replace, to }) => {
			if (replace) {
				window.location.replace(to);
				return;
			}
			window.location.assign(to);
		},
		redirectTo,
	});

	return (
		<AuthProvider {...commonProps}>
			{children}
			<ToastProvider placement="top" />
		</AuthProvider>
	);
}

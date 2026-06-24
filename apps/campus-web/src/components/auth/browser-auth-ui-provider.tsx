import { AuthProvider } from "@better-auth-ui/heroui";
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
	redirectTo,
}: {
	children: ReactNode;
	redirectTo?: string;
}) {
	const commonProps = createCampusAuthUIProviderProps({
		authLink: BrowserAuthLink,
		navigate: ({ replace, to }) => {
			if (replace) {
				window.location.replace(to);
				return;
			}
			window.location.assign(to);
		},
		redirectTo,
	});

	return <AuthProvider {...commonProps}>{children}</AuthProvider>;
}

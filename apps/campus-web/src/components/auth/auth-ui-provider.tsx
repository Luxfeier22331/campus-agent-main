import { AuthProvider } from "@better-auth-ui/heroui";
import { ToastProvider } from "@heroui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { createCampusAuthUIProviderProps } from "./auth-ui-provider-config";

function AuthLink({
	children,
	className,
	href,
}: {
	children: ReactNode;
	className?: string;
	href: string;
}) {
	return (
		<Link className={className} to={href}>
			{children}
		</Link>
	);
}

export function CampusAuthUIProvider({
	children,
	redirectTo,
}: {
	children: ReactNode;
	redirectTo?: string;
}) {
	const navigate = useNavigate();
	const commonProps = createCampusAuthUIProviderProps({
		authLink: AuthLink,
		navigate: ({ replace, to }) => {
			void navigate({ replace, to });
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

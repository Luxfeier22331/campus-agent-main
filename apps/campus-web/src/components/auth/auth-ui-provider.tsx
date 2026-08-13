import { AuthProvider } from "@better-auth-ui/heroui";
import { ToastProvider } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { createCampusSettingsProviderProps } from "./auth-ui-provider-config";

export function CampusAuthUIProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const commonProps = createCampusSettingsProviderProps({
		navigate: ({ replace, to }) => {
			void navigate({ ...(replace === undefined ? {} : { replace }), to });
		},
	});

	return (
		<AuthProvider {...commonProps}>
			{children}
			<ToastProvider placement="top" />
		</AuthProvider>
	);
}

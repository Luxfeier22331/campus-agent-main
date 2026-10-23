import { AuthProvider } from "@better-auth-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { campusAuthClient } from "@/platform/auth/client";

export function CampusAuthUIProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: false } },
			}),
	);

	return (
		<AuthProvider
			authClient={campusAuthClient}
			queryClient={queryClient}
			navigate={({ replace, to }) => {
				void navigate({ ...(replace === undefined ? {} : { replace }), to });
			}}
		>
			{children}
		</AuthProvider>
	);
}

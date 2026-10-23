import type { ReactNode } from "react";
import { CampusSessionValueProvider } from "../../src/platform/auth/session";

export interface TestSessionState {
	data: { user: { email?: string; id: string; name: string } } | null;
	status: "anonymous" | "authenticated" | "loading" | "unavailable";
}

export function TestSessionProvider({
	children,
	session,
}: {
	children: ReactNode;
	session: TestSessionState;
}) {
	return (
		<CampusSessionValueProvider
			value={{
				data: session.data as never,
				error: null,
				isRefreshing: false,
				refresh: async () => undefined,
				status: session.status,
			}}
		>
			{children}
		</CampusSessionValueProvider>
	);
}

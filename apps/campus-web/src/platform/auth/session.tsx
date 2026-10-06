import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";

import { campusAuthClient } from "./client";

export type CampusSession = typeof campusAuthClient.$Infer.Session;
export type CampusSessionStatus = "anonymous" | "authenticated" | "loading" | "unavailable";

export interface CampusSessionState {
	data: CampusSession | null;
	error: Error | null;
	isRefreshing: boolean;
	refresh: () => Promise<void>;
	status: CampusSessionStatus;
}

const CampusSessionContext = createContext<CampusSessionState | null>(null);

export function CampusSessionValueProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: CampusSessionState;
}) {
	return <CampusSessionContext.Provider value={value}>{children}</CampusSessionContext.Provider>;
}

export function CampusSessionProvider({ children }: { children: ReactNode }) {
	const session = campusAuthClient.useSession();
	const refresh = useCallback(() => session.refetch(), [session.refetch]);
	const sessionUnauthorized = isUnauthorizedSessionError(session.error);
	const status: CampusSessionStatus = session.isPending
		? "loading"
		: sessionUnauthorized
			? "anonymous"
			: session.error
				? session.data
					? "authenticated"
					: "unavailable"
				: session.data
					? "authenticated"
					: "anonymous";
	const value = useMemo<CampusSessionState>(
		() => ({
			data: session.data,
			error: session.error,
			isRefreshing: session.isRefetching,
			refresh,
			status,
		}),
		[refresh, session.data, session.error, session.isRefetching, status],
	);

	return <CampusSessionContext.Provider value={value}>{children}</CampusSessionContext.Provider>;
}

function isUnauthorizedSessionError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as { status?: unknown; error?: { status?: unknown } };
	return candidate.status === 401 || candidate.error?.status === 401;
}

export function useCampusSession(): CampusSessionState {
	const session = useContext(CampusSessionContext);
	if (!session) {
		throw new Error("useCampusSession must be used within CampusSessionProvider.");
	}
	return session;
}

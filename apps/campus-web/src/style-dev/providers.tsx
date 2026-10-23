import {
	AssistantRuntimeProvider,
	type ChatModelAdapter,
	InMemoryThreadListAdapter,
	type RemoteThreadListAdapter,
	useLocalRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import type { CampusSession, CampusSessionState } from "@/platform/auth/session";

export const STYLE_DEV_NO_OP_ADAPTER: ChatModelAdapter = {
	async run() {
		return { content: [] };
	},
};

export const STYLE_DEV_ANONYMOUS_SESSION = {
	data: null,
	error: null,
	isRefreshing: false,
	refresh: async () => undefined,
	status: "anonymous",
} satisfies CampusSessionState;

function useStyleDevRuntime() {
	return useLocalRuntime(STYLE_DEV_NO_OP_ADAPTER);
}

export const STYLE_DEV_AUTHENTICATED_SESSION = {
	data: {
		session: { id: "style-dev-session" },
		user: {
			email: "student@muc.edu.cn",
			id: "style-dev-user",
			name: "校园用户",
			passwordChangeRequired: false,
		},
	} as CampusSession,
	error: null,
	isRefreshing: false,
	refresh: async () => undefined,
	status: "authenticated",
} satisfies CampusSessionState;

export function StyleDevRouter({ children }: PropsWithChildren) {
	const router = useMemo(() => {
		const rootRoute = createRootRoute({ component: () => <>{children}</> });
		return createRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
			routeTree: rootRoute,
		});
	}, [children]);

	return <RouterProvider router={router} />;
}

export function StyleDevAssistantRuntime({
	children,
	initialMessages = [],
}: PropsWithChildren<{
	initialMessages?: NonNullable<Parameters<typeof useLocalRuntime>[1]>["initialMessages"];
}>) {
	const runtime = useLocalRuntime(STYLE_DEV_NO_OP_ADAPTER, { initialMessages });
	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function createStyleDevThreadListAdapter(
	threads: readonly {
		lastMessageAt: Date;
		remoteId: string;
		status: "archived" | "regular";
		title: string;
	}[],
): RemoteThreadListAdapter {
	const base = new InMemoryThreadListAdapter();
	return {
		archive: async () => base.archive(),
		delete: async () => base.delete(),
		fetch: async (threadId) =>
			threads.find((thread) => thread.remoteId === threadId) ?? {
				lastMessageAt: new Date("2026-08-19T12:00:00+08:00"),
				remoteId: threadId,
				status: "regular",
				title: "新会话",
			},
		generateTitle: async () => base.generateTitle(),
		initialize: async (threadId) => base.initialize(threadId),
		list: async () => ({ threads: [...threads] }),
		rename: async () => base.rename(),
		unarchive: async () => base.unarchive(),
		updateCustom: async () => base.updateCustom(),
	};
}

export function StyleDevRemoteThreadRuntime({
	children,
	threads,
}: PropsWithChildren<{
	threads: readonly {
		lastMessageAt: Date;
		remoteId: string;
		status: "archived" | "regular";
		title: string;
	}[];
}>) {
	const adapter = useMemo(() => createStyleDevThreadListAdapter(threads), [threads]);
	const runtime = useRemoteThreadListRuntime({ adapter, runtimeHook: useStyleDevRuntime });
	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

import { useChatbotShellRuntime } from "@platform/chat/runtime";
import type { ShellChatUser } from "@platform/chat/types";
import { ActiveChatProvider } from "@platform/chat/use-active-chat";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

function readDefaultSidebarOpen() {
	if (typeof document === "undefined") {
		return true;
	}

	const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("sidebar_state="));

	return cookie ? cookie.slice("sidebar_state=".length) === "true" : true;
}

function ChatShellFrame(props: { children: ReactNode; user: ShellChatUser | undefined }) {
	return (
		<DataStreamProvider>
			<SidebarProvider defaultOpen={readDefaultSidebarOpen()}>
				<AppSidebar user={props.user} />
				<SidebarInset>{props.children}</SidebarInset>
			</SidebarProvider>
		</DataStreamProvider>
	);
}

export function ChatAppShell() {
	const { session } = useChatbotShellRuntime();

	if (session.kind === "authenticated") {
		const user: ShellChatUser = {
			email: session.principal.email,
			name: session.principal.displayName,
		};

		return (
			<ChatShellFrame user={user}>
				<ActiveChatProvider>
					<ChatShell />
				</ActiveChatProvider>
			</ChatShellFrame>
		);
	}

	throw new Error("ChatAppShell rendered outside authenticated chat route ownership.");
}

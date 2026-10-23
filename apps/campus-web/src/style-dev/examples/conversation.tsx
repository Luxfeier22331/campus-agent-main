import { useMemo } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { CampusSessionValueProvider } from "@/platform/auth/session";
import type { StyleDevStory } from "../contracts";
import {
	STYLE_DEV_AUTHENTICATED_SESSION,
	StyleDevAssistantRuntime,
	StyleDevRemoteThreadRuntime,
	StyleDevRouter,
} from "../providers";

function ThreadExample() {
	const initialMessages = useMemo(
		() => [
			{
				content: [{ text: "东区图书馆今天几点关门？", type: "text" as const }],
				id: "style-dev-user-message",
				role: "user" as const,
			},
			{
				content: [
					{
						text: "东区图书馆今天开放至 22:00。",
						type: "text" as const,
					},
				],
				id: "style-dev-assistant-message",
				role: "assistant" as const,
				status: { reason: "stop" as const, type: "complete" as const },
			},
		],
		[],
	);
	return (
		<StyleDevAssistantRuntime initialMessages={initialMessages}>
			<Thread composerPlaceholder="输入校园问题" />
		</StyleDevAssistantRuntime>
	);
}

const THREADS = [
	{
		lastMessageAt: new Date("2026-08-19T20:30:00+08:00"),
		remoteId: "style-dev-thread-1",
		status: "regular" as const,
		title: "东区图书馆今天几点关门？",
	},
	{
		lastMessageAt: new Date("2026-08-19T18:20:00+08:00"),
		remoteId: "style-dev-thread-2",
		status: "regular" as const,
		title: "考试周场馆开放安排",
	},
];

function ThreadSidebarExample({ empty = false }: { empty?: boolean }) {
	return (
		<StyleDevRouter>
			<StyleDevRemoteThreadRuntime threads={empty ? [] : THREADS}>
				<CampusSessionValueProvider value={STYLE_DEV_AUTHENTICATED_SESSION}>
					<div className="style-dev-sidebar-preview-frame">
						<SidebarProvider className="style-dev-sidebar-preview-provider">
							<div className="style-dev-sidebar-preview-mobile-trigger">
								<SidebarTrigger aria-label="打开聊天记录" registerAsMobileOpener />
							</div>
							<ThreadListSidebar
								accountLoading={false}
								accountUnavailable={false}
								authenticated
								className="style-dev-sidebar-preview-panel"
								collapsible="icon"
								onLoginRequired={() => undefined}
								onRetryAccountStatus={() => undefined}
								retryingAccountStatus={false}
							/>
						</SidebarProvider>
					</div>
				</CampusSessionValueProvider>
			</StyleDevRemoteThreadRuntime>
		</StyleDevRouter>
	);
}

export const CONVERSATION_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "messages",
		variants: [{ id: "messages", label: "消息与输入", render: () => <ThreadExample /> }],
		group: "问答",
		id: "style-dev-conversation-thread",
		title: "对话消息与输入",
	},
	{
		defaultVariant: "records",
		variants: [
			{ id: "records", label: "有记录", render: () => <ThreadSidebarExample /> },
			{ id: "empty", label: "空记录", render: () => <ThreadSidebarExample empty /> },
		],
		group: "问答",
		id: "style-dev-conversation-sidebar",
		title: "聊天工作区与侧栏",
	},
];

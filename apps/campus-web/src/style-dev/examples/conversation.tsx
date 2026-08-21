import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { useMemo } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import {
	CampusRunStatus,
	CampusRunStatusRuntimeProvider,
} from "@/components/conversation/campus-run-status";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { ChatRunStep } from "@/features/conversation/run-client";
import {
	type CampusRunViewState,
	campusRunViewToMetadata,
} from "@/features/conversation/run-view-state";
import { CampusSessionValueProvider } from "@/platform/auth/session";
import type { StyleDevStory } from "../contracts";
import {
	STYLE_DEV_AUTHENTICATED_SESSION,
	STYLE_DEV_NO_OP_ADAPTER,
	StyleDevAssistantRuntime,
	StyleDevRemoteThreadRuntime,
	StyleDevRouter,
} from "../providers";

const RUN_NOW = Date.parse("2026-08-19T20:30:06+08:00");

const COMPLETED_RUN: CampusRunViewState = {
	acceptedAt: "2026-08-19T20:30:00+08:00",
	completedAt: "2026-08-19T20:30:05+08:00",
	connection: "live",
	durationMs: 5_000,
	operationId: 1,
	phase: "finalizing",
	provisional: false,
	requestId: "req_style_dev",
	runId: "run_style_dev",
	sequence: 8,
	startedAt: "2026-08-19T20:30:01+08:00",
	status: "completed",
};

const RUNNING_RUN: CampusRunViewState = {
	...COMPLETED_RUN,
	completedAt: null,
	durationMs: null,
	phase: "generating",
	status: "running",
};

const FAILED_RUN: CampusRunViewState = {
	...COMPLETED_RUN,
	completedAt: "2026-08-19T20:30:04+08:00",
	durationMs: 4_000,
	status: "failed",
};

const RUN_STEPS: readonly ChatRunStep[] = [
	{
		completedAt: "2026-08-19T20:30:01+08:00",
		durationMs: 1_000,
		phase: "preparing",
		startedAt: "2026-08-19T20:30:00+08:00",
		status: "completed",
	},
	{
		completedAt: "2026-08-19T20:30:04+08:00",
		durationMs: 3_000,
		phase: "generating",
		startedAt: "2026-08-19T20:30:01+08:00",
		status: "completed",
	},
	{
		completedAt: "2026-08-19T20:30:05+08:00",
		durationMs: 1_000,
		phase: "finalizing",
		startedAt: "2026-08-19T20:30:04+08:00",
		status: "completed",
	},
];

function useStaticRunStatusRuntime() {
	return useMemo(
		() => ({
			loadSteps: async (_input: { runId: string; signal: AbortSignal }) => ({ steps: RUN_STEPS }),
			now: () => RUN_NOW,
			resume: async () => undefined,
		}),
		[],
	);
}

function RunStatusExample({
	run,
	expanded = false,
}: {
	run: CampusRunViewState;
	expanded?: boolean;
}) {
	const statusRuntime = useStaticRunStatusRuntime();
	const runtime = useLocalRuntime(STYLE_DEV_NO_OP_ADAPTER);
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<CampusRunStatusRuntimeProvider runtime={statusRuntime}>
				<div className="style-dev-conversation-status-example">
					<CampusRunStatus defaultStepsOpen={expanded} run={run} />
				</div>
			</CampusRunStatusRuntimeProvider>
		</AssistantRuntimeProvider>
	);
}

function ThreadExample() {
	const statusRuntime = useStaticRunStatusRuntime();
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
				metadata: { custom: { campusRun: campusRunViewToMetadata(COMPLETED_RUN) } },
				role: "assistant" as const,
				status: { reason: "stop" as const, type: "complete" as const },
			},
		],
		[],
	);
	return (
		<StyleDevAssistantRuntime initialMessages={initialMessages}>
			<CampusRunStatusRuntimeProvider runtime={statusRuntime}>
				<Thread allowAttachments={false} composerPlaceholder="输入校园问题" />
			</CampusRunStatusRuntimeProvider>
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
		defaultVariant: "running",
		variants: [
			{ id: "running", label: "进行中", render: () => <RunStatusExample run={RUNNING_RUN} /> },
			{
				id: "completed",
				label: "回答过程",
				render: () => <RunStatusExample expanded run={COMPLETED_RUN} />,
			},
			{ id: "failed", label: "失败", render: () => <RunStatusExample run={FAILED_RUN} /> },
		],
		group: "问答",
		id: "style-dev-conversation-run-status",
		title: "回答状态",
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

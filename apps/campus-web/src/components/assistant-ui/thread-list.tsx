import {
	AuiIf,
	ThreadListItemMorePrimitive,
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { Button, Input, Skeleton } from "@campus-agent/ui";
import {
	ArchiveIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	SquarePen,
	TrashIcon,
} from "lucide-react";
import { type FC, type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { pinConversation, unpinConversation } from "@/features/conversation/api";
import { formatThreadListTime } from "./thread-list-time";

export const ThreadList: FC<{
	accountLoading: boolean;
	accountUnavailable: boolean;
	authenticated: boolean;
	onNavigate?: (() => void) | undefined;
	onRetryAccountStatus: () => void;
	retryingAccountStatus: boolean;
}> = ({
	accountLoading,
	accountUnavailable,
	authenticated,
	onNavigate,
	onRetryAccountStatus,
	retryingAccountStatus,
}) => {
	const [actionError, setActionError] = useState<string | null>(null);

	if (accountLoading) {
		return (
			<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
				<ThreadListSkeleton />
			</ThreadListPrimitive.Root>
		);
	}

	if (accountUnavailable) {
		return (
			<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-2 px-2.5 py-3">
				<p className="m-0 text-xs leading-5 text-muted-foreground" role="alert">
					账号状态暂时不可用，聊天记录未能读取。
				</p>
				<Button
					aria-busy={retryingAccountStatus || undefined}
					disabled={retryingAccountStatus}
					onClick={onRetryAccountStatus}
					size="sm"
					variant="outline"
				>
					{retryingAccountStatus ? "正在重试" : "重试"}
				</Button>
			</ThreadListPrimitive.Root>
		);
	}

	if (!authenticated) {
		return (
			<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
				<p className="text-muted-foreground px-2.5 py-3 text-xs">登录后可查看聊天记录</p>
			</ThreadListPrimitive.Root>
		);
	}

	return (
		<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
			{actionError ? (
				<p role="alert" className="text-destructive px-2.5 py-1 text-xs">
					{actionError}
				</p>
			) : null}
			<AuiIf condition={(s) => s.threads.isLoading}>
				<ThreadListSkeleton />
			</AuiIf>
			<AuiIf condition={(s) => !s.threads.isLoading}>
				<ThreadListItems onActionError={setActionError} onNavigate={onNavigate} />
			</AuiIf>
		</ThreadListPrimitive.Root>
	);
};

export const ThreadListNewButton: FC<{ onNavigate?: (() => void) | undefined }> = ({
	onNavigate,
}) => (
	<ThreadListPrimitive.New asChild>
		<SidebarMenuButton
			className="h-11 px-2.5 lg:h-9 group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!p-3"
			onClick={onNavigate}
			tooltip="新对话"
			type="button"
		>
			<SquarePen aria-hidden="true" />
			<span>新对话</span>
		</SidebarMenuButton>
	</ThreadListPrimitive.New>
);

const SKELETON_THREAD_IDS = ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"] as const;

const DAY_IN_MS = 86_400_000;

const dateGroupLabel = (date: Date | undefined, startOfToday: number): string => {
	if (!date || date.getTime() >= startOfToday) {
		return "今天";
	}
	if (date.getTime() >= startOfToday - DAY_IN_MS) {
		return "昨天";
	}
	return "更早";
};

interface ThreadListGroup {
	label: string;
	indices: number[];
}

export function readPinnedAt(custom: Record<string, unknown> | undefined): string | null {
	return typeof custom?.pinnedAt === "string" && custom.pinnedAt.length > 0
		? custom.pinnedAt
		: null;
}

interface ThreadListActionErrorProps {
	onActionError: (message: string | null) => void;
}

interface ThreadListItemsProps extends ThreadListActionErrorProps {
	onNavigate?: (() => void) | undefined;
}

const ThreadListItems: FC<ThreadListItemsProps> = ({ onActionError, onNavigate }) => {
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);

	const groups = useMemo<ThreadListGroup[] | null>(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
		if (threadIds.length === 0) {
			return null;
		}

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const itemAt = (index: number) => {
			const id = threadIds[index];
			return id ? itemsById.get(id) : undefined;
		};
		const time = (index: number) => dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const indices = threadIds
			.map((_, index) => index)
			.sort((a, b) => {
				const pinnedDelta =
					Number(Boolean(readPinnedAt(itemAt(b)?.custom))) -
					Number(Boolean(readPinnedAt(itemAt(a)?.custom)));
				return pinnedDelta || time(b) - time(a);
			});
		const pinnedIndices = indices.filter((index) => Boolean(readPinnedAt(itemAt(index)?.custom)));
		const unpinnedIndices = indices.filter((index) => !readPinnedAt(itemAt(index)?.custom));

		const result: ThreadListGroup[] = [];
		if (pinnedIndices.length > 0) {
			result.push({ indices: pinnedIndices, label: "置顶" });
		}
		for (const index of unpinnedIndices) {
			const label = dateGroupLabel(dates[index], startOfToday);
			const lastGroup = result.at(-1);
			if (lastGroup?.label === label) {
				lastGroup.indices.push(index);
			} else {
				result.push({ label, indices: [index] });
			}
		}
		return result;
	}, [threadIds, threadItems]);
	const ThreadListItemWithError = useMemo(
		() => () => <ThreadListItem onActionError={onActionError} onNavigate={onNavigate} />,
		[onActionError, onNavigate],
	);

	if (!groups) {
		return (
			<ThreadListPrimitive.Items>
				{() => <ThreadListItem onActionError={onActionError} onNavigate={onNavigate} />}
			</ThreadListPrimitive.Items>
		);
	}

	return groups.map((group) => (
		<Fragment key={group.label}>
			<div className="aui-thread-list-group-label text-muted-foreground px-2.5 pb-1 pt-3 text-xs font-medium">
				{group.label}
			</div>
			{group.indices.map((index) => (
				<ThreadListPrimitive.ItemByIndex
					key={threadIds[index]}
					index={index}
					components={{ ThreadListItem: ThreadListItemWithError }}
				/>
			))}
		</Fragment>
	));
};

const ThreadListSkeleton: FC = () => (
	<div
		aria-atomic="true"
		aria-label="正在加载聊天记录"
		className="flex flex-col gap-0.5"
		role="status"
	>
		{SKELETON_THREAD_IDS.map((id) => (
			<div
				aria-hidden="true"
				key={id}
				className="aui-thread-list-skeleton-wrapper flex h-14 items-center px-2.5 lg:h-12"
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Skeleton className="aui-thread-list-skeleton h-3.5 w-full" />
					<Skeleton className="aui-thread-list-skeleton h-2.5 w-16" />
				</div>
			</div>
		))}
	</div>
);

const ThreadListItem: FC<ThreadListItemsProps> = ({ onActionError, onNavigate }) => {
	const runtime = useAui().threadListItem;
	const title = useAuiState((state) => state.threadListItem.title) || "新对话";
	const lastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt);
	const isPinned = useAuiState((state) => Boolean(readPinnedAt(state.threadListItem.custom)));
	const inputRef = useRef<HTMLInputElement>(null);
	const [draftTitle, setDraftTitle] = useState(title);
	const [isEditing, setIsEditing] = useState(false);
	const [isRenamePending, setIsRenamePending] = useState(false);

	useEffect(() => {
		if (!isEditing) {
			return;
		}
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isEditing]);

	const beginRename = () => {
		onActionError(null);
		setDraftTitle(title);
		setIsEditing(true);
	};

	const submitRename = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextTitle = draftTitle.trim();
		if (!nextTitle) {
			onActionError("标题不能为空。");
			return;
		}
		if (nextTitle === title) {
			setIsEditing(false);
			return;
		}

		onActionError(null);
		setIsRenamePending(true);
		try {
			await runtime.rename(nextTitle);
			setIsEditing(false);
		} catch {
			onActionError("重命名失败，请稍后重试。");
		} finally {
			setIsRenamePending(false);
		}
	};

	return (
		<ThreadListItemPrimitive.Root className="aui-thread-list-item group hover:bg-surface-hover data-active:bg-selected data-active:text-selected-foreground relative grid min-h-14 grid-cols-[minmax(0,1fr)_4.5rem] items-stretch rounded-[var(--radius-lg)] transition-colors motion-reduce:transition-none lg:min-h-12">
			{isEditing ? (
				<form
					className="flex min-w-0 items-center px-1"
					onSubmit={(event) => void submitRename(event)}
				>
					<Input
						aria-label={`重命名 ${title}`}
						aria-busy={isRenamePending || undefined}
						className="h-9 w-full px-2 text-sm lg:h-8"
						onBlur={() => {
							if (!isRenamePending) {
								setIsEditing(false);
							}
						}}
						onChange={(event) => setDraftTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								setIsEditing(false);
							}
						}}
						ref={inputRef}
						readOnly={isRenamePending}
						value={draftTitle}
					/>
				</form>
			) : (
				<ThreadListItemPrimitive.Trigger
					aria-label={title}
					className="aui-thread-list-item-trigger flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-start text-sm"
					onClick={onNavigate}
				>
					{isPinned ? <PinIcon aria-hidden="true" className="me-1.5 size-3.5 shrink-0" /> : null}
					<span className="flex min-w-0 flex-1 flex-col justify-center">
						<span className="aui-thread-list-item-title min-w-0 truncate leading-5" title={title}>
							<ThreadListItemPrimitive.Title fallback="新对话" />
						</span>
						<time
							className="aui-thread-list-item-time truncate text-muted-foreground text-xs leading-4"
							dateTime={lastMessageAt?.toISOString()}
						>
							{formatThreadListTime(lastMessageAt)}
						</time>
					</span>
				</ThreadListItemPrimitive.Trigger>
			)}
			<div className="flex w-[4.5rem] shrink-0 items-center justify-end gap-0.5 pe-1">
				{isEditing ? null : (
					<>
						<ThreadListItemPin onActionError={onActionError} />
						<ThreadListItemMore onActionError={onActionError} onRename={beginRename} />
					</>
				)}
			</div>
		</ThreadListItemPrimitive.Root>
	);
};

const ThreadListItemPin: FC<ThreadListActionErrorProps> = ({ onActionError }) => {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const isPinned = useAuiState((state) => Boolean(readPinnedAt(state.threadListItem.custom)));
	const [isPending, setIsPending] = useState(false);
	const label = isPinned ? "取消置顶" : "置顶";

	const togglePin = async () => {
		if (!remoteId) {
			return;
		}
		onActionError(null);
		setIsPending(true);
		try {
			await (isPinned ? unpinConversation(remoteId) : pinConversation(remoteId));
			await aui.threads.reload();
		} catch {
			onActionError(isPinned ? "取消置顶失败，请稍后重试。" : "置顶失败，请稍后重试。");
		} finally {
			setIsPending(false);
		}
	};

	return (
		<TooltipIconButton
			aria-pressed={isPinned}
			aria-label={label}
			className={isPinned ? "text-primary" : "text-muted-foreground"}
			disabled={isPending || !remoteId}
			onClick={() => void togglePin()}
			tooltip={label}
		>
			{isPinned ? (
				<PinOffIcon aria-hidden="true" className="size-3.5" />
			) : (
				<PinIcon aria-hidden="true" className="size-3.5" />
			)}
		</TooltipIconButton>
	);
};

const ThreadListItemMore: FC<ThreadListActionErrorProps & { onRename: () => void }> = ({
	onActionError,
	onRename,
}) => {
	const aui = useAui();
	const runtime = aui.threadListItem;
	const [isActionPending, setIsActionPending] = useState(false);

	const runThreadAction = async (action: () => Promise<void> | void, failureMessage: string) => {
		onActionError(null);
		setIsActionPending(true);
		try {
			await action();
		} catch {
			onActionError(failureMessage);
		} finally {
			setIsActionPending(false);
		}
	};
	return (
		<ThreadListItemMorePrimitive.Root>
			<ThreadListItemMorePrimitive.Trigger asChild>
				<Button
					aria-label="更多操作"
					variant="ghost"
					size="icon"
					className="aui-thread-list-item-more data-[state=open]:bg-selected size-8 p-0 lg:size-7"
					title="更多操作"
				>
					<MoreHorizontalIcon className="size-3.5" />
					<span className="sr-only">更多操作</span>
				</Button>
			</ThreadListItemMorePrimitive.Trigger>
			<ThreadListItemMorePrimitive.Content
				side="right"
				align="start"
				sideOffset={6}
				className="aui-thread-list-item-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg"
			>
				<ThreadListItemMorePrimitive.Item
					disabled={isActionPending}
					onSelect={() => {
						window.setTimeout(onRename, 0);
					}}
					className="aui-thread-list-item-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 lg:min-h-8"
				>
					<PencilIcon aria-hidden="true" className="size-4" />
					重命名
				</ThreadListItemMorePrimitive.Item>
				<ThreadListItemMorePrimitive.Item
					disabled={isActionPending}
					onSelect={(event) => {
						event.preventDefault();
						void runThreadAction(runtime.archive, "归档失败，请稍后重试。");
					}}
					className="aui-thread-list-item-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 lg:min-h-8"
				>
					<ArchiveIcon className="size-4" />
					归档
				</ThreadListItemMorePrimitive.Item>
				<ThreadListItemMorePrimitive.Item
					disabled={isActionPending}
					onSelect={(event) => {
						event.preventDefault();
						void runThreadAction(runtime.delete, "删除失败，请稍后重试。");
					}}
					className="aui-thread-list-item-more-item text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 lg:min-h-8"
				>
					<TrashIcon className="size-4" />
					删除
				</ThreadListItemMorePrimitive.Item>
			</ThreadListItemMorePrimitive.Content>
		</ThreadListItemMorePrimitive.Root>
	);
};

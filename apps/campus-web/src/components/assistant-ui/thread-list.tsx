import {
	AuiIf,
	ThreadListItemMorePrimitive,
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { Button, Input, Skeleton } from "@campus-agent/ui";
import { ArchiveIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { type FC, type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export const ThreadList: FC<{
	accountPending: boolean;
	authenticated: boolean;
	onNavigate?: (() => void) | undefined;
}> = ({ accountPending, authenticated, onNavigate }) => {
	const [actionError, setActionError] = useState<string | null>(null);

	if (accountPending) {
		return (
			<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
				<ThreadListSkeleton />
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
			<AuiIf condition={(s) => !s.threads.isLoading && s.threads.threadIds.length === 0}>
				<p className="text-muted-foreground px-2.5 py-3 text-xs">暂无聊天记录</p>
			</AuiIf>
		</ThreadListPrimitive.Root>
	);
};

export const ThreadListNewButton: FC<{ onNavigate?: (() => void) | undefined }> = ({
	onNavigate,
}) => (
	<ThreadListPrimitive.New asChild>
		<SidebarMenuButton
			className="h-11 px-2.5 group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!p-3"
			onClick={onNavigate}
			tooltip="新对话"
			type="button"
		>
			<PlusIcon aria-hidden="true" />
			<span>新对话</span>
		</SidebarMenuButton>
	</ThreadListPrimitive.New>
);

const DAY_IN_MS = 86_400_000;
const SKELETON_THREAD_IDS = ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"] as const;

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
		if (!dates.some(Boolean)) {
			return null;
		}

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const time = (index: number) => dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const indices = threadIds.map((_, index) => index).sort((a, b) => time(b) - time(a));

		const result: ThreadListGroup[] = [];
		for (const index of indices) {
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
			<div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
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
	<div className="flex flex-col gap-0.5">
		{SKELETON_THREAD_IDS.map((id) => (
			<div
				key={id}
				role="status"
				aria-label="正在加载聊天记录"
				className="aui-thread-list-skeleton-wrapper flex h-11 items-center px-2.5 lg:h-9"
			>
				<Skeleton className="aui-thread-list-skeleton h-3.5 w-full" />
			</div>
		))}
	</div>
);

const ThreadListItem: FC<ThreadListItemsProps> = ({ onActionError, onNavigate }) => {
	const runtime = useAui().threadListItem;
	const title = useAuiState((state) => state.threadListItem.title) || "新对话";
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
		<ThreadListItemPrimitive.Root className="aui-thread-list-item group hover:bg-surface-hover data-active:bg-selected relative flex h-11 items-center rounded-md transition-colors lg:h-9">
			{isEditing ? (
				<form className="min-w-0 flex-1 px-1" onSubmit={(event) => void submitRename(event)}>
					<Input
						aria-label={`重命名 ${title}`}
						aria-busy={isRenamePending || undefined}
						className="h-9 w-full px-2 text-sm lg:h-7"
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
					className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 pe-12 text-start text-sm lg:pe-2.5 lg:group-hover:pe-10 lg:group-has-data-[state=open]:pe-10 lg:group-data-active:pe-10"
					onClick={onNavigate}
				>
					<span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
						<ThreadListItemPrimitive.Title fallback="新对话" />
					</span>
				</ThreadListItemPrimitive.Trigger>
			)}
			{isEditing ? null : (
				<ThreadListItemMore onActionError={onActionError} onRename={beginRename} />
			)}
		</ThreadListItemPrimitive.Root>
	);
};

const ThreadListItemMore: FC<ThreadListActionErrorProps & { onRename: () => void }> = ({
	onActionError,
	onRename,
}) => {
	const runtime = useAui().threadListItem;
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
					variant="ghost"
					size="icon"
					className="aui-thread-list-item-more data-[state=open]:bg-selected absolute end-0 top-0 z-10 size-11 p-0 opacity-100 lg:end-1 lg:top-1 lg:size-7 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:group-data-active:opacity-100 data-[state=open]:opacity-100"
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

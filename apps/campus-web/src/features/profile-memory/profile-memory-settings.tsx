import {
	Alert,
	AlertDescription,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	AlertTitle,
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/utils";
import {
	createProfileMemoryItem,
	deleteProfileMemoryItem,
	eraseProfileMemory,
	getProfileMemory,
	type ProfileMemoryItem,
	setProfileMemoryEnabled,
	updateProfileMemoryItem,
} from "./api";

const PROFILE_MEMORY_QUERY_KEY = ["profile-memory"] as const;

export function ProfileMemorySettings() {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<ProfileMemoryItem | null>(null);
	const [eraseOpen, setEraseOpen] = useState(false);
	const query = useQuery({
		queryKey: PROFILE_MEMORY_QUERY_KEY,
		queryFn: getProfileMemory,
		refetchInterval: (result) => {
			const value = result.state.data;
			return value?.lifecycleState === "erasing" || value?.syncStatus === "pending" ? 2_000 : false;
		},
	});
	const settle = async () => queryClient.invalidateQueries({ queryKey: PROFILE_MEMORY_QUERY_KEY });
	const lifecycle = useMutation({ mutationFn: setProfileMemoryEnabled, onSettled: settle });
	const createItem = useMutation({ mutationFn: createProfileMemoryItem, onSettled: settle });
	const updateItem = useMutation({ mutationFn: updateProfileMemoryItem, onSettled: settle });
	const deleteItem = useMutation({ mutationFn: deleteProfileMemoryItem, onSettled: settle });
	const erase = useMutation({ mutationFn: eraseProfileMemory, onSettled: settle });
	const memory = query.data;
	const busy = memory?.lifecycleState === "erasing" || memory?.syncStatus === "pending";
	const mutationError =
		lifecycle.error ?? createItem.error ?? updateItem.error ?? deleteItem.error ?? erase.error;

	if (query.isPending) {
		return <SettingsLoading />;
	}
	if (query.isError && !memory) {
		return (
			<SettingsError
				message={query.error instanceof Error ? query.error.message : "无法读取记忆设置。"}
				retry={() => query.refetch()}
			/>
		);
	}
	if (!memory) {
		return <SettingsLoading />;
	}

	return (
		<div className="mx-auto w-full max-w-4xl pb-16">
			<header className="border-b border-border pb-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold tracking-normal">个性化记忆</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							管理校园助手长期保留的个人偏好与背景。
						</p>
					</div>
					<div className="flex min-h-11 min-w-11 items-center justify-center">
						<button
							aria-checked={memory.lifecycleState === "active"}
							className={cn(
								"relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								memory.lifecycleState === "active"
									? "border-primary bg-primary"
									: "border-border bg-muted",
							)}
							disabled={busy || lifecycle.isPending || memory.lifecycleState === "erasing"}
							onClick={() => lifecycle.mutate(memory.lifecycleState !== "active")}
							role="switch"
							type="button"
						>
							<span
								className={cn(
									"absolute top-0.5 size-5 rounded-full bg-primary-foreground shadow transition-transform",
									memory.lifecycleState === "active" ? "translate-x-5" : "translate-x-0.5",
								)}
							/>
							<span className="sr-only">启用个性化记忆</span>
						</button>
					</div>
				</div>
				<div className="mt-4 flex items-center gap-2">
					<Badge tone="neutral">{statusLabel(memory.lifecycleState, memory.syncStatus)}</Badge>
					{busy ? (
						<LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground" />
					) : null}
				</div>
			</header>

			{query.isRefetchError ? (
				<Alert className="mt-6" tone="warning">
					<CircleAlert className="size-4" />
					<AlertTitle>记忆设置刷新失败</AlertTitle>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>当前显示最近一次成功读取的数据。</span>
						<Button onClick={() => void query.refetch()} size="sm" variant="outline">
							重试
						</Button>
					</AlertDescription>
				</Alert>
			) : null}
			{mutationError ? (
				<Alert className="mt-6" tone="danger">
					<CircleAlert className="size-4" />
					<AlertTitle>操作未完成</AlertTitle>
					<AlertDescription>{mutationError.message}</AlertDescription>
				</Alert>
			) : null}
			{memory.syncStatus === "failed" ? (
				<Alert className="mt-6" tone="danger">
					<CircleAlert className="size-4" />
					<AlertTitle>记忆同步失败</AlertTitle>
					<AlertDescription>
						重新执行对应操作即可重试；失败期间不会使用未同步的记忆。
					</AlertDescription>
				</Alert>
			) : null}

			<section className="py-8" aria-labelledby="declared-memory-heading">
				<div className="flex items-center justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold" id="declared-memory-heading">
							我的记忆
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">{memory.itemCount} 条</p>
					</div>
					<Button disabled={busy} onClick={() => setEditing(emptyItem())} size="sm">
						<Plus />
						添加
					</Button>
				</div>
				<div className="mt-5 divide-y rounded-md border">
					{memory.items.length === 0 ? (
						<p className="px-4 py-10 text-center text-sm text-muted-foreground">
							还没有可管理的记忆
						</p>
					) : (
						memory.items.map((item) => (
							<div className="flex min-h-20 items-center gap-4 px-4 py-3" key={item.itemId}>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{item.key}</p>
									<p className="mt-1 break-words text-sm text-muted-foreground">{item.value}</p>
								</div>
								{item.state === "synced" ? null : (
									<Badge tone={itemStateTone(item.state)}>{itemStateLabel(item.state)}</Badge>
								)}
								<Button
									aria-label="编辑记忆"
									disabled={busy || item.state === "deleting"}
									onClick={() => setEditing(item)}
									size="icon"
									variant="ghost"
								>
									<Pencil />
								</Button>
								<Button
									aria-label="删除记忆"
									disabled={busy || deleteItem.isPending}
									onClick={() => deleteItem.mutate(item.itemId)}
									size="icon"
									variant="ghost"
								>
									<Trash2 />
								</Button>
							</div>
						))
					)}
				</div>
			</section>

			<section className="border-t border-border pt-8" aria-labelledby="erase-memory-heading">
				<h2 className="text-lg font-semibold" id="erase-memory-heading">
					清除全部记忆
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					删除显式记忆、会话来源以及由它们生成的长期记忆。聊天记录不会因此删除。
				</p>
				<AlertDialog onOpenChange={setEraseOpen} open={eraseOpen}>
					<AlertDialogTrigger asChild>
						<Button className="mt-4" disabled={busy} variant="destructive">
							清除全部记忆
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>确认清除全部记忆？</AlertDialogTitle>
							<AlertDialogDescription>
								此操作会异步删除长期记忆，完成后无法恢复。
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<AlertDialogAction
								disabled={erase.isPending}
								onClick={(event) => {
									event.preventDefault();
									erase.mutate(undefined, { onSuccess: () => setEraseOpen(false) });
								}}
							>
								{erase.isPending ? <LoaderCircle className="animate-spin" /> : null}确认清除
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</section>

			<ItemEditor
				item={editing}
				onClose={() => setEditing(null)}
				onSubmit={(value) => {
					if (!editing) {
						return;
					}
					if (editing.itemId) {
						updateItem.mutate(
							{ itemId: editing.itemId, ...value },
							{ onSuccess: () => setEditing(null) },
						);
					} else {
						createItem.mutate(value, { onSuccess: () => setEditing(null) });
					}
				}}
				pending={createItem.isPending || updateItem.isPending}
			/>
		</div>
	);
}

function ItemEditor({
	item,
	onClose,
	onSubmit,
	pending,
}: {
	item: ProfileMemoryItem | null;
	onClose: () => void;
	onSubmit: (value: { key: string; value: string }) => void;
	pending: boolean;
}) {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const formKey = item ? `${item.itemId}:${item.revision}` : "closed";
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={item !== null}
		>
			<DialogContent key={formKey}>
				<form
					onSubmit={(event: FormEvent) => {
						event.preventDefault();
						onSubmit({ key: key || item?.key || "", value: value || item?.value || "" });
					}}
				>
					<DialogHeader>
						<DialogTitle>{item?.itemId ? "编辑记忆" : "添加记忆"}</DialogTitle>
						<DialogDescription>使用简短键名和明确内容保存一条个人信息。</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-5">
						<div className="grid gap-2">
							<Label htmlFor="memory-key">键名</Label>
							<Input
								defaultValue={item?.key}
								id="memory-key"
								maxLength={64}
								onChange={(event) => setKey(event.target.value)}
								required
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="memory-value">内容</Label>
							<Input
								defaultValue={item?.value}
								id="memory-value"
								maxLength={500}
								onChange={(event) => setValue(event.target.value)}
								required
							/>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={onClose} type="button" variant="outline">
							取消
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? <LoaderCircle className="animate-spin" /> : null}保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function emptyItem(): ProfileMemoryItem {
	return { itemId: "", key: "", revision: 0, state: "synced", updatedAt: "", value: "" };
}
function statusLabel(lifecycle: string, sync: string) {
	if (lifecycle === "erasing") {
		return "正在清除";
	}
	if (sync === "pending") {
		return "正在同步";
	}
	if (sync === "failed") {
		return "同步失败";
	}
	if (lifecycle === "paused") {
		return "已暂停";
	}
	if (lifecycle === "erased") {
		return "已清除";
	}
	return "已启用";
}
function itemStateLabel(state: string) {
	return state === "saving"
		? "保存中"
		: state === "deleting"
			? "删除中"
			: state === "failed"
				? "失败"
				: "已同步";
}
function itemStateTone(state: string): "danger" | "neutral" | "warning" {
	return state === "failed"
		? "danger"
		: state === "saving" || state === "deleting"
			? "warning"
			: "neutral";
}
function SettingsLoading() {
	return (
		<div className="flex min-h-56 items-center justify-center">
			<LoaderCircle className="size-5 animate-spin" />
			<span className="sr-only">正在加载记忆设置</span>
		</div>
	);
}
function SettingsError({ message, retry }: { message: string; retry: () => void }) {
	return (
		<Alert tone="danger">
			<CircleAlert className="size-4" />
			<AlertTitle>无法打开记忆设置</AlertTitle>
			<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
				<span>{message}</span>
				<Button onClick={retry} size="sm" variant="outline">
					重试
				</Button>
			</AlertDescription>
		</Alert>
	);
}

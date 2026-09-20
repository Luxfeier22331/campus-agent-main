import {
	ActionGroup,
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	ConfirmDialog,
	cn,
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
import { CircleAlert, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTimestamp } from "@/lib/date-time";
import { useCampusSession } from "@/platform/auth/session";
import {
	createProfileMemoryItem,
	eraseProfileMemory,
	getProfileMemory,
	getProfileMemoryItem,
	listProfileMemories,
	type ProfileMemoryItem,
	retryProfileMemoryOperation,
	setProfileMemoryEnabled,
	updateProfileMemoryItem,
} from "./api";

export function ProfileMemorySettings() {
	const userId = useCampusSession().data?.user.id ?? "";
	return <MemorySettings key={userId} userId={userId} />;
}
function MemorySettings({ userId }: { userId: string }) {
	const qc = useQueryClient();
	const key = ["profile-memory", userId] as const;
	const [q, setQ] = useState("");
	const [search, setSearch] = useState("");
	const [kind, setKind] = useState<ProfileMemoryItem["kind"] | "">("");
	const [state, setState] = useState<ProfileMemoryItem["state"]>("active");
	const [offset, setOffset] = useState(0);
	const [editing, setEditing] = useState<{ memoryId?: string; text: string } | null>(null);
	const [detailId, setDetailId] = useState<string | null>(null);
	const [eraseOpen, setEraseOpen] = useState(false);
	const root = useQuery({
		queryKey: [...key, "settings"],
		queryFn: getProfileMemory,
		enabled: Boolean(userId),
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
		refetchInterval: (result) => (result.state.data?.operations.some(isPending) ? 2000 : false),
	});
	const pending = root.data?.operations.some(isPending) ?? false;
	const items = useQuery({
		queryKey: [...key, "items", { q: search, kind, state, offset }],
		queryFn: () =>
			listProfileMemories({ q: search, ...(kind ? { kind } : {}), state, offset, limit: 20 }),
		enabled: Boolean(userId),
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
	const detail = useQuery({
		queryKey: [...key, "detail", detailId],
		queryFn: () => getProfileMemoryItem(detailId ?? ""),
		enabled: Boolean(userId) && detailId !== null,
		staleTime: 0,
	});
	// A terminal command can arrive after the response is shown. Refresh the bank
	// when pending work disappears, not just when the command is accepted.
	const previous = useRef<string[]>([]);
	useEffect(() => {
		if (!root.data) {
			return;
		}
		const current = root.data.operations.filter(isPending).map((op) => op.commandId);
		if (previous.current.some((id) => !current.includes(id))) {
			void qc.invalidateQueries({ queryKey: ["profile-memory", userId, "items"] });
			void qc.invalidateQueries({ queryKey: ["profile-memory", userId, "detail"] });
		}
		previous.current = current;
	}, [root.data, qc, userId]);
	useEffect(
		() => () => {
			qc.removeQueries({ queryKey: ["profile-memory", userId] });
		},
		[qc, userId],
	);
	const refresh = async (result: { commandId: string }) => {
		previous.current = [...previous.current, result.commandId];
		await qc.invalidateQueries({ queryKey: key });
	};
	const add = useMutation({ mutationFn: createProfileMemoryItem, onSuccess: refresh });
	const update = useMutation({ mutationFn: updateProfileMemoryItem, onSuccess: refresh });
	const erase = useMutation({ mutationFn: eraseProfileMemory, onSuccess: refresh });
	const toggle = useMutation({ mutationFn: setProfileMemoryEnabled, onSuccess: refresh });
	const retry = useMutation({ mutationFn: retryProfileMemoryOperation, onSuccess: refresh });
	const error = add.error ?? update.error ?? erase.error ?? toggle.error ?? retry.error;
	const memory = root.data;
	if (root.isPending) {
		return <Loading />;
	}
	if (!memory) {
		return (
			<ErrorMessage title="无法读取记忆设置" error={root.error} retry={() => void root.refetch()} />
		);
	}
	const blocked = memory.lifecycleState === "erasing" || memory.lifecycleState === "erased";
	const busy = (id: string) =>
		memory.operations.some((op) => op.memoryId === id && isPending(op)) ||
		(update.isPending && update.variables.memoryId === id);
	const renderItem = (item: ProfileMemoryItem) => (
		<div key={item.memoryId} className="space-y-2 rounded-md border p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge>
					{item.kind === "summary" ? "派生观察" : item.kind === "experience" ? "经历" : "事实"}
				</Badge>
				<span className="text-xs text-muted-foreground">{originLabel(item.origin)}</span>
				{item.state === "inactive" ? <Badge>已停用</Badge> : null}
				{busy(item.memoryId) ? <Badge>处理中</Badge> : null}
			</div>
			<p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>
			<ActionGroup>
				<Button size="sm" variant="ghost" onClick={() => setDetailId(item.memoryId)}>
					{item.kind === "summary" ? "查看支持事实" : "查看详情"}
				</Button>
				{item.kind === "summary" ? null : (
					<>
						<Button
							size="sm"
							variant="outline"
							aria-label="编辑记忆"
							disabled={blocked || busy(item.memoryId)}
							onClick={() => setEditing(item)}
						>
							编辑
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={blocked || busy(item.memoryId)}
							onClick={() =>
								update.mutate({
									memoryId: item.memoryId,
									state: item.state === "active" ? "inactive" : "active",
								})
							}
						>
							{item.state === "active" ? "停用" : "恢复"}
						</Button>
					</>
				)}
			</ActionGroup>
		</div>
	);
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 pb-16">
			<header className="border-b border-border pb-6">
				<h2 className="ui-section-title">个性化记忆</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					管理助手保存的事实、经历和派生观察。删除聊天记录不会清除记忆。
				</p>
				<div className="mt-3 flex items-center gap-2">
					<Badge>{lifecycleLabel(memory.lifecycleState)}</Badge>
					{pending ? (
						<>
							<LoaderCircle className="size-4 animate-spin" />
							<span className="text-sm">操作处理中</span>
						</>
					) : null}
					<button
						role="switch"
						aria-checked={memory.lifecycleState === "active"}
						aria-label="启用个性化记忆"
						type="button"
						className={cn(
							"relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							memory.lifecycleState === "active"
								? "border-primary bg-primary"
								: "border-border bg-muted",
						)}
						disabled={
							memory.lifecycleState === "erasing" ||
							memory.syncStatus === "pending" ||
							toggle.isPending
						}
						onClick={() => toggle.mutate(memory.lifecycleState !== "active")}
					>
						<span
							className={cn(
								"absolute top-0.5 size-5 rounded-full bg-primary-foreground shadow transition-transform",
								memory.lifecycleState === "active" ? "translate-x-5" : "translate-x-0.5",
							)}
						/>
					</button>
				</div>
				<p className="mt-2 text-xs text-muted-foreground">
					暂停后不读取或新增会话记忆，已有记忆仍可管理。停用不等于删除；需要彻底清除时请使用下方“清除全部记忆”。
				</p>
			</header>
			{root.isRefetchError ? (
				<ErrorMessage title="设置刷新失败" error={root.error} retry={() => void root.refetch()} />
			) : null}
			{error ? <ErrorMessage title="操作未完成" error={error} /> : null}
			{memory.operations
				.filter((op) => op.status === "failed" || op.errorCode)
				.map((op) => (
					<Alert key={op.commandId} tone="danger">
						<CircleAlert />
						<AlertTitle>{op.status === "failed" ? "记忆操作失败" : "记忆操作等待派发"}</AlertTitle>
						<AlertDescription>
							{op.errorCode ?? "操作失败"}
							{op.status === "failed" ? (
								<Button
									size="sm"
									onClick={() => retry.mutate(op.commandId)}
									disabled={retry.isPending}
								>
									重试操作
								</Button>
							) : null}
						</AlertDescription>
					</Alert>
				))}
			<section className="space-y-4" aria-label="我的记忆">
				<div className="flex justify-between">
					<h3 className="text-lg font-semibold">我的记忆</h3>
					<Button disabled={blocked} onClick={() => setEditing({ text: "" })}>
						<Plus />
						添加
					</Button>
				</div>
				<form
					className="flex flex-wrap gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						setSearch(q.trim());
						setOffset(0);
					}}
				>
					<Input
						aria-label="搜索记忆"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="搜索记忆"
					/>
					<Button type="submit" variant="outline">
						搜索
					</Button>
					<select
						aria-label="记忆类型"
						value={kind}
						onChange={(e) => {
							setKind(e.target.value as typeof kind);
							setOffset(0);
						}}
						className="rounded border p-2 text-sm"
					>
						<option value="">全部类型</option>
						<option value="fact">事实</option>
						<option value="experience">经历</option>
						<option value="summary">派生观察</option>
					</select>
					<select
						aria-label="记忆状态"
						value={state}
						onChange={(e) => {
							setState(e.target.value as typeof state);
							setOffset(0);
						}}
						className="rounded border p-2 text-sm"
					>
						<option value="active">启用中的记忆</option>
						<option value="inactive">已停用的记忆</option>
					</select>
				</form>
				{items.isError ? (
					<ErrorMessage
						title="无法读取记忆内容"
						error={items.error}
						retry={() => void items.refetch()}
					/>
				) : null}
				{items.isPending ? (
					<Loading />
				) : items.data && items.data.items.length > 0 ? (
					items.data.items.map(renderItem)
				) : items.isError ? null : (
					<p className="py-8 text-sm text-muted-foreground">没有匹配的记忆</p>
				)}
				{items.data ? (
					<div className="flex items-center gap-3 text-sm">
						<span>共 {items.data.total} 条</span>
						<Button
							variant="outline"
							size="sm"
							disabled={offset === 0}
							onClick={() => setOffset(Math.max(0, offset - 20))}
						>
							上一页
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={offset + items.data.items.length >= items.data.total}
							onClick={() => setOffset(offset + 20)}
						>
							下一页
						</Button>
					</div>
				) : null}
			</section>
			<section className="border-t pt-5">
				<h3 className="font-semibold">清除全部记忆</h3>
				<p className="my-3 text-sm text-muted-foreground">
					清除全部长期记忆、来源资料和停用归档，完成后保持关闭。聊天记录不受影响，也不会自动重新导入。
				</p>
				<ConfirmDialog
					open={eraseOpen}
					onOpenChange={setEraseOpen}
					title="确认清除全部记忆？"
					description="此操作不可恢复。聊天记录保留，记忆完成清除后保持关闭。"
					confirmLabel="确认清除"
					pending={erase.isPending}
					error={
						erase.error
							? erase.error instanceof Error
								? erase.error.message
								: "清除请求未完成。"
							: null
					}
					onConfirm={() => erase.mutate(undefined, { onSuccess: () => setEraseOpen(false) })}
					trigger={
						<Button
							variant="destructive"
							disabled={
								erase.isPending ||
								(memory.lifecycleState === "erasing" && memory.syncStatus !== "failed")
							}
						>
							清除全部记忆
						</Button>
					}
				/>
			</section>
			<Dialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditing(null);
					}
				}}
			>
				<DialogContent>
					{editing ? (
						<Editor
							key={editing.memoryId ?? "new"}
							item={editing}
							pending={add.isPending || update.isPending}
							save={(text) =>
								editing.memoryId
									? update.mutate(
											{ memoryId: editing.memoryId, text },
											{ onSuccess: () => setEditing(null) },
										)
									: add.mutate({ text }, { onSuccess: () => setEditing(null) })
							}
						/>
					) : null}
				</DialogContent>
			</Dialog>
			<Dialog
				open={detailId !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDetailId(null);
					}
				}}
			>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>记忆详情</DialogTitle>
						<DialogDescription>
							派生观察由事实自动生成，请修改或停用它的支持事实。
						</DialogDescription>
					</DialogHeader>
					{detail.isPending ? (
						<Loading />
					) : detail.isError ? (
						<ErrorMessage
							title="读取详情失败"
							error={detail.error}
							retry={() => void detail.refetch()}
						/>
					) : detail.data ? (
						<>
							<p className="whitespace-pre-wrap">{detail.data.text}</p>
							<p className="text-xs text-muted-foreground">
								{originLabel(detail.data.origin)}
								{detail.data.editedAt ? ` · 修改于 ${formatTimestamp(detail.data.editedAt)}` : ""}
							</p>
							{detail.data.kind === "summary" ? (
								<section className="space-y-3">
									<h3 className="font-semibold">支持事实</h3>
									{detail.data.sourceMemories && detail.data.sourceMemories.length > 0 ? (
										detail.data.sourceMemories.map((source) => (
											<div key={source.memoryId} className="space-y-2 rounded-md border p-4">
												<p className="whitespace-pre-wrap text-sm">{source.text}</p>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setDetailId(source.memoryId)}
												>
													查看并管理这条事实
												</Button>
											</div>
										))
									) : (
										<p className="text-sm">没有可用的支持事实。</p>
									)}
								</section>
							) : (
								renderItem(detail.data)
							)}
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}
function Editor({
	item,
	pending,
	save,
}: {
	item: { memoryId?: string; text: string };
	pending: boolean;
	save: (text: string) => void;
}) {
	const [text, setText] = useState(item.text);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				save(text);
			}}
		>
			<DialogHeader>
				<DialogTitle>{item.memoryId ? "编辑记忆" : "添加记忆"}</DialogTitle>
				<DialogDescription>用自然语言描述个人偏好或背景。</DialogDescription>
			</DialogHeader>
			<Label htmlFor="memory-text">内容</Label>
			<textarea
				id="memory-text"
				required
				className="my-3 min-h-24 w-full rounded border p-2"
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<DialogFooter>
				<Button type="submit" disabled={pending || !text.trim()}>
					保存
				</Button>
			</DialogFooter>
		</form>
	);
}
function isPending(op: { status: string }) {
	return op.status === "pending_admission" || op.status === "admitted";
}
function lifecycleLabel(state: string) {
	return (
		(
			{ active: "已启用", paused: "已暂停", erasing: "正在清除", erased: "已清除" } as Record<
				string,
				string
			>
		)[state] ?? state
	);
}
function originLabel(origin: string) {
	return (
		(
			{
				manual: "手动添加",
				conversation: "来自会话",
				derived: "由事实生成",
				unknown: "来源未标注",
			} as Record<string, string>
		)[origin] ?? origin
	);
}
function Loading() {
	return (
		<div className="flex min-h-24 items-center justify-center">
			<LoaderCircle className="size-5 animate-spin" />
			<span className="sr-only">正在加载记忆</span>
		</div>
	);
}
function ErrorMessage({
	title,
	error,
	retry,
}: {
	title: string;
	error: unknown;
	retry?: () => void;
}) {
	return (
		<Alert tone="danger">
			<CircleAlert />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				{error instanceof Error ? error.message : "服务暂时不可用。"}
				{retry ? (
					<Button size="sm" variant="outline" onClick={retry}>
						重试
					</Button>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

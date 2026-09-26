import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	ConfirmDialog,
	cn,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTimestamp } from "@/lib/date-time";
import { useCampusSession } from "@/platform/auth/session";
import {
	createProfileMemoryCorrection,
	eraseProfileMemory,
	getProfileMemory,
	getProfileMemoryProfile,
	retryProfileMemoryOperation,
	setProfileMemoryEnabled,
} from "./api";

export function ProfileMemorySettings() {
	const userId = useCampusSession().data?.user.id ?? "";
	return <MemorySettings key={userId} userId={userId} />;
}
function MemorySettings({ userId }: { userId: string }) {
	const qc = useQueryClient();
	const key = ["profile-memory", userId] as const;
	const [correction, setCorrection] = useState("");
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
	const readable =
		Boolean(userId) && root.data !== undefined && root.data.lifecycleState !== "erased";
	const profile = useQuery({
		queryKey: [...key, "profile"],
		queryFn: getProfileMemoryProfile,
		enabled: readable,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
	// A terminal command can arrive after the response is shown. Refresh the
	// profile when pending work disappears, not just when the command is accepted.
	const previous = useRef<string[]>([]);
	useEffect(() => {
		if (!root.data) {
			return;
		}
		const current = root.data.operations.filter(isPending).map((op) => op.commandId);
		if (previous.current.some((id) => !current.includes(id))) {
			void qc.invalidateQueries({ queryKey: ["profile-memory", userId, "profile"] });
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
	const submit = useMutation({ mutationFn: createProfileMemoryCorrection, onSuccess: refresh });
	const erase = useMutation({ mutationFn: eraseProfileMemory, onSuccess: refresh });
	const toggle = useMutation({ mutationFn: setProfileMemoryEnabled, onSuccess: refresh });
	const retry = useMutation({ mutationFn: retryProfileMemoryOperation, onSuccess: refresh });
	const error = submit.error ?? erase.error ?? toggle.error ?? retry.error;
	const memory = root.data;
	if (root.isPending) {
		return <Loading />;
	}
	if (!memory) {
		return (
			<ErrorMessage title="无法读取记忆设置" error={root.error} retry={() => void root.refetch()} />
		);
	}
	const blocked = memory.lifecycleState === "erased";
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 pb-16">
			<header className="border-b border-border pb-6">
				<h2 className="ui-section-title">个性化记忆</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					助手从对话中了解你，并维护一份随时可纠正的画像。删除聊天记录不会清除记忆。
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
						disabled={memory.syncStatus === "pending" || toggle.isPending}
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
					暂停后不读取或新增会话记忆，已有画像仍可查看和纠正。停用不等于删除；需要彻底清除时请使用下方“清除全部记忆”。
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
			<section className="space-y-4" aria-label="我的画像">
				<h3 className="text-lg font-semibold">我的画像</h3>
				{memory.lifecycleState === "erased" ? (
					<p className="py-8 text-sm text-muted-foreground">记忆已清除，画像为空。</p>
				) : profile.isError ? (
					<ErrorMessage
						title="无法读取画像"
						error={profile.error}
						retry={() => void profile.refetch()}
					/>
				) : profile.isPending ? (
					<Loading />
				) : profile.data ? (
					<div className="space-y-3 rounded-md border p-4">
						<div className="flex flex-wrap items-center gap-2">
							{profile.data.generating ? <Badge>生成中</Badge> : null}
							{profile.data.isStale ? <Badge>待更新</Badge> : null}
							{profile.data.lastRefreshedAt ? (
								<span className="text-xs text-muted-foreground">
									更新于 {formatTimestamp(profile.data.lastRefreshedAt)}
								</span>
							) : null}
						</div>
						{profile.data.generating && !profile.data.content ? (
							<p className="text-sm text-muted-foreground">
								助手还没有足够记忆生成画像，可以先在对话中告诉它你的偏好。
							</p>
						) : (
							<p className="whitespace-pre-wrap break-words text-sm">{profile.data.content}</p>
						)}
					</div>
				) : null}
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						const text = correction.trim();
						if (text) {
							submit.mutate({ text });
							setCorrection("");
						}
					}}
				>
					<label className="text-sm font-medium" htmlFor="memory-correction">
						纠正画像
					</label>
					<textarea
						id="memory-correction"
						className="min-h-20 w-full rounded border p-2 text-sm"
						placeholder="例如：我更喜欢先看到结论；不要再把我当作新生。"
						value={correction}
						onChange={(e) => setCorrection(e.target.value)}
						disabled={blocked || submit.isPending}
					/>
					<div className="flex items-center gap-2">
						<Button type="submit" disabled={blocked || submit.isPending || !correction.trim()}>
							提交纠正
						</Button>
						<span className="text-xs text-muted-foreground">
							纠正会随下一次对话生效，画像由全部记忆重新合成。
						</span>
					</div>
				</form>
			</section>
			<section className="border-t pt-5">
				<h3 className="font-semibold">清除全部记忆</h3>
				<p className="my-3 text-sm text-muted-foreground">
					清除全部长期记忆和画像，完成后保持关闭。聊天记录不受影响，也不会自动重新导入。
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
							disabled={erase.isPending || memory.syncStatus === "pending"}
						>
							清除全部记忆
						</Button>
					}
				/>
			</section>
		</div>
	);
}
function isPending(op: { status: string }) {
	return op.status === "pending_admission" || op.status === "admitted";
}
function lifecycleLabel(state: string) {
	return (
		({ active: "已启用", paused: "已暂停", erased: "已清除" } as Record<string, string>)[state] ??
		state
	);
}
function Loading() {
	return (
		<div className="flex min-h-24 items-center justify-center">
			<LoaderCircle className="size-5 animate-spin" />
			<span className="sr-only">正在加载画像</span>
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

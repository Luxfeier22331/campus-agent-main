import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type AccountAdminEvent,
	type AccountAdminSession,
	AccountAdminUserDetailSchema,
	TemporaryPasswordResponseSchema,
} from "campus-contracts/account-admin";
import { ArrowLeft, Ban, KeyRound, Mail, RefreshCw, ShieldCheck, ShieldX, X } from "lucide-react";
import { useState } from "react";
import {
	AccountAccessBadge,
	AccountOutcomeBadge,
	AccountStateBadge,
	accountActionLabel,
} from "./account-admin-display";
import { normalizeUsersReturnPath } from "./account-admin-navigation";
import { formatTimestamp } from "./format";
import {
	commandAccountAdminUser,
	fetchAccountAdminUser,
	revokeAccountAdminSession,
} from "./ops-api/account-admin";
import { OpsApiError } from "./ops-api/core";
import { CopyableValue, ErrorState, InlineError, KeyValue, PageHeader } from "./ops-display";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

type StandardAction =
	| "ban"
	| "password-reset-email"
	| "sessions-revoke-all"
	| "unban"
	| "verification-email";

type Confirmation =
	| {
			action: Extract<StandardAction, "ban" | "sessions-revoke-all" | "unban">;
			confirmLabel: string;
			description: string;
			kind: "command";
			reason: string;
			title: string;
	  }
	| {
			confirmLabel: string;
			description: string;
			kind: "session";
			sessionId: string;
			title: string;
	  };

interface StandardCommandAttempt {
	action: StandardAction;
	idempotencyKey: string;
	payload: Record<string, never> | { reason: string };
	successMessage: string;
}

interface TemporaryPasswordAttempt {
	idempotencyKey: string;
	reason: string;
}

interface SessionCommandAttempt {
	idempotencyKey: string;
	sessionId: string;
}

type RetryableAttempt =
	| { kind: "command"; value: StandardCommandAttempt }
	| { kind: "session"; value: SessionCommandAttempt }
	| { kind: "temporary-password"; value: TemporaryPasswordAttempt };

function retryableCommandError(error: unknown): boolean {
	return !(
		error instanceof OpsApiError &&
		error.status < 500 &&
		error.code !== "account_admin_command_in_progress"
	);
}

function commandSuccessMessage(action: StandardAction): string {
	return {
		ban: "账号已封禁。",
		"password-reset-email": "密码重置邮件已提交发送。",
		"sessions-revoke-all": "全部会话已撤销。",
		unban: "账号已恢复。",
		"verification-email": "邮箱验证邮件已提交发送。",
	}[action];
}

export function UserDetailPage({ from, userId }: { from?: string; userId: string }) {
	const queryClient = useQueryClient();
	const [reason, setReason] = useState("");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [commandError, setCommandError] = useState<unknown>(null);
	const [commandNotice, setCommandNotice] = useState<string | null>(null);
	const [retryableAttempt, setRetryableAttempt] = useState<RetryableAttempt | null>(null);
	const [temporaryPassword, setTemporaryPassword] = useState<
		ReturnType<typeof TemporaryPasswordResponseSchema.parse> | undefined
	>();
	const user = useQuery({
		queryFn: ({ signal }) => fetchAccountAdminUser(userId, { signal }),
		queryKey: ["ops", "users", userId],
	});
	const invalidateUserLists = () => {
		void queryClient.invalidateQueries({
			predicate: (query) =>
				query.queryKey[0] === "ops" &&
				query.queryKey[1] === "users" &&
				query.queryKey[2] !== userId,
		});
	};
	const prepareCommand = () => {
		setCommandError(null);
		setCommandNotice(null);
		setRetryableAttempt(null);
	};
	const command = useMutation({
		mutationFn: async (attempt: StandardCommandAttempt) =>
			AccountAdminUserDetailSchema.parse(
				await commandAccountAdminUser(userId, attempt.action, attempt.payload, {
					idempotencyKey: attempt.idempotencyKey,
				}),
			),
		onError: (error, attempt) => {
			setCommandError(error);
			setRetryableAttempt(
				retryableCommandError(error) ? { kind: "command", value: attempt } : null,
			);
		},
		onMutate: prepareCommand,
		onSuccess: (result, attempt) => {
			queryClient.setQueryData(["ops", "users", userId], result);
			invalidateUserLists();
			setCommandNotice(attempt.successMessage);
			setRetryableAttempt(null);
			if ("reason" in attempt.payload) {
				setReason("");
			}
		},
	});
	const issueTemporaryPassword = useMutation({
		mutationFn: async (attempt: TemporaryPasswordAttempt) =>
			TemporaryPasswordResponseSchema.parse(
				await commandAccountAdminUser(
					userId,
					"temporary-password",
					{ reason: attempt.reason },
					{ idempotencyKey: attempt.idempotencyKey },
				),
			),
		onError: (error, attempt) => {
			setCommandError(error);
			setRetryableAttempt(
				retryableCommandError(error) ? { kind: "temporary-password", value: attempt } : null,
			);
		},
		onMutate: prepareCommand,
		onSuccess: (result) => {
			setTemporaryPassword(result);
			setReason("");
			setRetryableAttempt(null);
			invalidateUserLists();
			void user.refetch();
		},
	});
	const revokeSession = useMutation({
		mutationFn: (attempt: SessionCommandAttempt) =>
			revokeAccountAdminSession(userId, attempt.sessionId, {
				idempotencyKey: attempt.idempotencyKey,
			}),
		onError: (error, attempt) => {
			setCommandError(error);
			setRetryableAttempt(
				retryableCommandError(error) ? { kind: "session", value: attempt } : null,
			);
		},
		onMutate: prepareCommand,
		onSuccess: (result) => {
			queryClient.setQueryData(["ops", "users", userId], result);
			invalidateUserLists();
			setCommandNotice("会话已撤销。");
			setRetryableAttempt(null);
		},
	});
	const commandPending =
		command.isPending || issueTemporaryPassword.isPending || revokeSession.isPending;
	const startCommand = (action: StandardAction, payload: StandardCommandAttempt["payload"]) =>
		command.mutate({
			action,
			idempotencyKey: crypto.randomUUID(),
			payload,
			successMessage: commandSuccessMessage(action),
		});
	const retryLastCommand = () => {
		if (retryableAttempt?.kind === "command") {
			command.mutate(retryableAttempt.value);
		}
		if (retryableAttempt?.kind === "session") {
			revokeSession.mutate(retryableAttempt.value);
		}
		if (retryableAttempt?.kind === "temporary-password") {
			issueTemporaryPassword.mutate(retryableAttempt.value);
		}
	};

	if (user.isPending) {
		return <p className="text-muted-foreground text-sm">正在读取用户...</p>;
	}
	if (user.isError || !user.data) {
		return (
			<ErrorState error={user.error} onRetry={() => void user.refetch()} title="用户详情读取失败" />
		);
	}
	const detail = user.data;
	const deletionInProgress = detail.state === "deleting";
	const returnPath = normalizeUsersReturnPath(from);
	const requestReasonedAction = (
		action: Extract<StandardAction, "ban" | "sessions-revoke-all" | "unban">,
		title: string,
		description: string,
		confirmLabel: string,
	) => {
		const commandReason = reason.trim();
		if (commandReason) {
			setConfirmation({
				action,
				confirmLabel,
				description,
				kind: "command",
				reason: commandReason,
				title,
			});
		}
	};
	const confirmRequestedAction = () => {
		if (!confirmation) {
			return;
		}
		if (confirmation.kind === "command") {
			startCommand(confirmation.action, { reason: confirmation.reason });
		} else {
			revokeSession.mutate({
				idempotencyKey: crypto.randomUUID(),
				sessionId: confirmation.sessionId,
			});
		}
		setConfirmation(null);
	};

	return (
		<section>
			<PageHeader
				actions={
					<div className="flex gap-2">
						<Button asChild variant="outline">
							<a href={returnPath}>
								<ArrowLeft className="size-4" />
								返回
							</a>
						</Button>
						<Button
							disabled={user.isFetching}
							onClick={() => void user.refetch()}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							刷新
						</Button>
					</div>
				}
				description={detail.email}
				title={detail.name}
			/>
			{commandError ? (
				<div className="mb-4 grid gap-2">
					<InlineError error={commandError} title="用户操作失败" />
					{retryableAttempt ? (
						<div>
							<Button disabled={commandPending} onClick={retryLastCommand} variant="outline">
								<RefreshCw className="size-4" />
								重试同一操作
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			{commandNotice ? (
				<p
					className="mb-4 rounded-md border border-success/20 bg-success-subtle px-3 py-2 text-success text-sm"
					role="status"
				>
					{commandNotice}
				</p>
			) : null}
			{commandPending ? (
				<p className="mb-4 text-muted-foreground text-sm" role="status">
					正在执行账号操作...
				</p>
			) : null}
			{temporaryPassword ? (
				<div
					className="mb-4 grid gap-3 rounded-md border border-warning/20 bg-warning-subtle p-4"
					role="status"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="font-semibold text-warning">临时密码</p>
							<p className="text-foreground text-sm">
								有效期至 {formatTimestamp(temporaryPassword.expiresAt)}
							</p>
						</div>
						<Button
							aria-label="关闭临时密码"
							onClick={() => setTemporaryPassword(undefined)}
							variant="ghost"
						>
							<X className="size-4" />
						</Button>
					</div>
					<CopyableValue label="临时密码" value={temporaryPassword.temporaryPassword} />
				</div>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
				<Card>
					<CardHeader>
						<CardTitle>账号信息</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-1 sm:grid-cols-2">
						<KeyValue label="账号状态" value={<AccountStateBadge state={detail.state} />} />
						<KeyValue
							label="访问状态"
							value={<AccountAccessBadge source={detail.accessSource} state={detail.accessState} />}
						/>
						<KeyValue
							label="用户 ID"
							value={<span className="font-mono text-xs">{detail.id}</span>}
						/>
						<KeyValue label="邮箱已验证" value={detail.emailVerified ? "是" : "否"} />
						<KeyValue label="密码账号" value={detail.credentialAccount ? "是" : "否"} />
						<KeyValue label="有效会话" value={detail.activeSessionCount} />
						<KeyValue label="封禁原因" value={detail.banReason ?? "-"} />
						<KeyValue label="注册时间" value={formatTimestamp(detail.createdAt)} />
						<KeyValue label="更新时间" value={formatTimestamp(detail.updatedAt)} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>账号操作</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4">
						<label
							className="grid gap-1 text-muted-foreground text-xs"
							htmlFor="account-admin-reason"
						>
							操作原因
							<Input
								className="min-h-10"
								id="account-admin-reason"
								name="reason"
								onChange={(event) => setReason(event.target.value)}
								value={reason}
							/>
						</label>
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={deletionInProgress || commandPending}
								onClick={() => startCommand("password-reset-email", {})}
								variant="outline"
							>
								<Mail className="size-4" />
								发送重置邮件
							</Button>
							<Button
								disabled={deletionInProgress || detail.emailVerified || commandPending}
								onClick={() => startCommand("verification-email", {})}
								variant="outline"
							>
								<ShieldCheck className="size-4" />
								发送验证邮件
							</Button>
							<Button
								disabled={!reason.trim() || deletionInProgress || commandPending}
								onClick={() =>
									issueTemporaryPassword.mutate({
										idempotencyKey: crypto.randomUUID(),
										reason: reason.trim(),
									})
								}
								variant="outline"
							>
								<KeyRound className="size-4" />
								签发临时密码
							</Button>
							<Button
								disabled={!reason.trim() || deletionInProgress || commandPending}
								onClick={() =>
									requestReasonedAction(
										"sessions-revoke-all",
										"撤销全部会话",
										"该用户当前的全部会话将立即失效，需要重新登录。",
										"确认撤销",
									)
								}
								variant="outline"
							>
								<ShieldX className="size-4" />
								撤销全部会话
							</Button>
							{detail.state === "banned" ? (
								<Button
									disabled={!reason.trim() || commandPending}
									onClick={() =>
										requestReasonedAction(
											"unban",
											"恢复账号",
											"恢复后，该用户可以重新登录并使用校园问答。",
											"确认恢复",
										)
									}
								>
									<ShieldCheck className="size-4" />
									恢复账号
								</Button>
							) : (
								<Button
									disabled={!reason.trim() || deletionInProgress || commandPending}
									onClick={() =>
										requestReasonedAction(
											"ban",
											"封禁账号",
											"该账号将无法登录，当前全部会话也会立即失效。",
											"确认封禁",
										)
									}
								>
									<Ban className="size-4" />
									封禁账号
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			{detail.deletion ? (
				<Card className="mt-4">
					<CardHeader>
						<CardTitle>账号注销状态</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
						<KeyValue
							label="状态"
							value={detail.deletion.status === "pending" ? "处理中" : "已完成"}
						/>
						<KeyValue label="申请时间" value={formatTimestamp(detail.deletion.requestedAt)} />
						<KeyValue label="尝试次数" value={detail.deletion.attemptCount} />
						<KeyValue label="最近尝试" value={formatTimestamp(detail.deletion.lastAttemptAt)} />
						{detail.deletion.status === "pending" ? (
							<KeyValue label="下次尝试" value={formatTimestamp(detail.deletion.nextAttemptAt)} />
						) : (
							<KeyValue label="完成时间" value={formatTimestamp(detail.deletion.completedAt)} />
						)}
						<KeyValue label="最近错误" value={detail.deletion.lastErrorCode ?? "-"} />
						<KeyValue
							label="请求 ID"
							value={<span className="font-mono text-xs">{detail.deletion.requestId}</span>}
						/>
						<KeyValue label="更新时间" value={formatTimestamp(detail.deletion.updatedAt)} />
					</CardContent>
				</Card>
			) : null}

			<div className="mt-6">
				<h2 className="mb-3 font-semibold text-foreground text-lg">会话</h2>
				<DataTable<AccountAdminSession>
					caption="用户会话"
					columns={[
						{
							cell: (row) => formatTimestamp(row.createdAt),
							cellClassName: "hidden sm:table-cell",
							header: "创建时间",
							headerClassName: "hidden sm:table-cell",
							id: "created",
						},
						{
							cell: (row) => formatTimestamp(row.expiresAt),
							header: "到期时间",
							id: "expires",
							rowHeader: true,
						},
						{
							cell: (row) => row.ipAddress ?? "-",
							cellClassName: "hidden md:table-cell",
							header: "IP 地址",
							headerClassName: "hidden md:table-cell",
							id: "ip",
						},
						{
							cell: (row) => row.userAgent ?? "-",
							cellClassName: "hidden lg:table-cell",
							header: "客户端",
							headerClassName: "hidden lg:table-cell",
							id: "client",
						},
						{
							cell: (row) => (
								<Button
									disabled={commandPending}
									onClick={() =>
										setConfirmation({
											confirmLabel: "确认撤销",
											description: "该会话将立即失效，用户需要重新登录。",
											kind: "session",
											sessionId: row.id,
											title: "撤销会话",
										})
									}
									variant="outline"
								>
									撤销
								</Button>
							),
							header: "操作",
							id: "actions",
							stickyRight: true,
						},
					]}
					data={detail.sessions}
					emptyMessage="该用户当前没有会话。"
					minWidth="0"
					rowKey={(row) => row.id}
				/>
			</div>

			<div className="mt-6">
				<h2 className="mb-3 font-semibold text-foreground text-lg">操作记录</h2>
				<DataTable<AccountAdminEvent>
					caption="账号操作记录"
					columns={[
						{
							cell: (row) => formatTimestamp(row.occurredAt),
							header: "时间",
							id: "time",
							rowHeader: true,
						},
						{ cell: (row) => accountActionLabel(row.action), header: "操作", id: "action" },
						{
							cell: (row) => row.actorId,
							cellClassName: "hidden md:table-cell",
							header: "操作者",
							headerClassName: "hidden md:table-cell",
							id: "actor",
						},
						{
							cell: (row) => row.reason ?? "-",
							cellClassName: "hidden lg:table-cell",
							header: "原因",
							headerClassName: "hidden lg:table-cell",
							id: "reason",
						},
						{
							cell: (row) => <AccountOutcomeBadge outcome={row.outcome} />,
							header: "结果",
							id: "outcome",
						},
					]}
					data={detail.events}
					emptyMessage="该用户还没有账号操作记录。"
					minWidth="0"
					rowKey={(row) => row.eventId}
				/>
			</div>

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setConfirmation(null);
					}
				}}
				open={confirmation !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
						<AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel asChild>
							<Button variant="outline">取消</Button>
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								disabled={commandPending}
								onClick={confirmRequestedAction}
								variant="destructive"
							>
								{confirmation?.confirmLabel}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

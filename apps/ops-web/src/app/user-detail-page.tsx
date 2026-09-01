import { Button } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AccountAdminUserDetailSchema,
	type TemporaryPasswordResponse,
	TemporaryPasswordResponseSchema,
} from "campus-contracts/account-admin";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { normalizeUsersReturnPath } from "./account-admin-navigation";
import {
	commandAccountAdminUser,
	fetchAccountAdminUser,
	revokeAccountAdminSession,
} from "./ops-api/account-admin";
import { ErrorState, PageHeader } from "./ops-display";
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
import {
	UserDetailAccountActions,
	UserDetailAccountOverview,
	UserDetailDeletionStatus,
} from "./user-detail-account-sections";
import { UserDetailCommandFeedback } from "./user-detail-command-feedback";
import {
	type Confirmation,
	commandSuccessMessage,
	type ReasonedAction,
	type RetryableAttempt,
	retryableCommandError,
	type SessionCommandAttempt,
	type StandardAction,
	type StandardCommandAttempt,
	type TemporaryPasswordAttempt,
} from "./user-detail-model";
import { UserDetailEventsTable, UserDetailSessionsTable } from "./user-detail-tables";

export function UserDetailPage({ from, userId }: { from?: string; userId: string }) {
	const queryClient = useQueryClient();
	const [reason, setReason] = useState("");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [commandError, setCommandError] = useState<unknown>(null);
	const [commandNotice, setCommandNotice] = useState<string | null>(null);
	const [retryableAttempt, setRetryableAttempt] = useState<RetryableAttempt | null>(null);
	const [temporaryPassword, setTemporaryPassword] = useState<
		TemporaryPasswordResponse | undefined
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
	const returnPath = normalizeUsersReturnPath(from);
	const requestReasonedAction = (
		action: ReasonedAction,
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
			<UserDetailCommandFeedback
				commandError={commandError}
				commandNotice={commandNotice}
				commandPending={commandPending}
				onDismissTemporaryPassword={() => setTemporaryPassword(undefined)}
				onRetry={retryLastCommand}
				retryableAttempt={retryableAttempt}
				temporaryPassword={temporaryPassword}
			/>
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
				<UserDetailAccountOverview detail={detail} />
				<UserDetailAccountActions
					commandPending={commandPending}
					detail={detail}
					onIssueTemporaryPassword={() =>
						issueTemporaryPassword.mutate({
							idempotencyKey: crypto.randomUUID(),
							reason: reason.trim(),
						})
					}
					onReasonChange={setReason}
					onRequestReasonedAction={requestReasonedAction}
					onStartCommand={startCommand}
					reason={reason}
				/>
			</div>
			<UserDetailDeletionStatus detail={detail} />
			<UserDetailSessionsTable
				commandPending={commandPending}
				onRevoke={(sessionId) =>
					setConfirmation({
						confirmLabel: "确认撤销",
						description: "该会话将立即失效，用户需要重新登录。",
						kind: "session",
						sessionId,
						title: "撤销会话",
					})
				}
				sessions={detail.sessions}
			/>
			<UserDetailEventsTable events={detail.events} />

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

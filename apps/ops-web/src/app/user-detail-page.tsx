import { ActionGroup, Button, ConfirmDialog, StateMessage } from "@campus-agent/ui";
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

	const returnPath = normalizeUsersReturnPath(from);
	if (!user.data) {
		return (
			<section>
				<PageHeader
					title="用户详情"
					actions={
						<Button asChild variant="ghost">
							<a href={returnPath}>
								<ArrowLeft className="size-4" />
								返回
							</a>
						</Button>
					}
				/>
				{user.isError ? (
					<ErrorState
						error={user.error}
						onRetry={() => void user.refetch()}
						title="用户详情读取失败"
					/>
				) : (
					<StateMessage layout="inline" role="status" description="正在读取用户..." />
				)}
			</section>
		);
	}

	const detail = user.data;
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
			command.mutate(
				{
					action: confirmation.action,
					payload: { reason: confirmation.reason },
					idempotencyKey: crypto.randomUUID(),
					successMessage: commandSuccessMessage(confirmation.action),
				},
				{ onSuccess: () => setConfirmation(null) },
			);
		} else {
			revokeSession.mutate(
				{
					idempotencyKey: crypto.randomUUID(),
					sessionId: confirmation.sessionId,
				},
				{ onSuccess: () => setConfirmation(null) },
			);
		}
	};

	return (
		<section>
			<PageHeader
				actions={
					<ActionGroup>
						<Button asChild variant="ghost">
							<a href={returnPath}>
								<ArrowLeft className="size-4" />
								返回
							</a>
						</Button>
						<Button disabled={user.isFetching} onClick={() => void user.refetch()} variant="ghost">
							<RefreshCw className="size-4" />
							刷新
						</Button>
					</ActionGroup>
				}
				description={detail.email}
				title={detail.name}
			/>
			{user.isError ? (
				<ErrorState
					error={user.error}
					onRetry={() => void user.refetch()}
					title="用户详情刷新失败"
				/>
			) : null}
			<UserDetailCommandFeedback
				commandError={commandError}
				commandNotice={commandNotice}
				commandPending={commandPending}
				onDismissTemporaryPassword={() => setTemporaryPassword(undefined)}
				onRetry={retryLastCommand}
				retryableAttempt={retryableAttempt}
				temporaryPassword={temporaryPassword}
			/>
			<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
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

			<ConfirmDialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmation(null);
					}
				}}
				title={confirmation?.title}
				description={confirmation?.description}
				confirmLabel={confirmation?.confirmLabel ?? "确认"}
				pending={commandPending}
				error={
					commandError
						? commandError instanceof Error
							? commandError.message
							: "操作未完成，请重试。"
						: null
				}
				onConfirm={confirmRequestedAction}
			/>
		</section>
	);
}

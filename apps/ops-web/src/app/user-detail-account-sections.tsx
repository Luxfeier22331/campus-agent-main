import {
	ActionGroup,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Field,
	Input,
} from "@campus-agent/ui";
import type { AccountAdminUserDetail } from "campus-contracts/account-admin";
import { Ban, KeyRound, Mail, ShieldCheck, ShieldX } from "lucide-react";
import { AccountAccessBadge, AccountStateBadge } from "./account-admin-display";
import { formatTimestamp } from "./format";
import { KeyValue } from "./ops-display";
import type { ReasonedAction, StandardAction, StandardCommandAttempt } from "./user-detail-model";

export function UserDetailAccountOverview({ detail }: { detail: AccountAdminUserDetail }) {
	return (
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
				<KeyValue label="用户 ID" value={<span className="font-mono text-xs">{detail.id}</span>} />
				<KeyValue label="邮箱已验证" value={detail.emailVerified ? "是" : "否"} />
				<KeyValue label="密码账号" value={detail.credentialAccount ? "是" : "否"} />
				<KeyValue label="有效会话" value={detail.activeSessionCount} />
				<KeyValue label="封禁原因" value={detail.banReason ?? "-"} />
				<KeyValue label="注册时间" value={formatTimestamp(detail.createdAt)} />
				<KeyValue label="更新时间" value={formatTimestamp(detail.updatedAt)} />
			</CardContent>
		</Card>
	);
}

export function UserDetailDeletionStatus({ detail }: { detail: AccountAdminUserDetail }) {
	if (!detail.deletion) {
		return null;
	}
	return (
		<Card className="mt-4">
			<CardHeader>
				<CardTitle>账号注销状态</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
				<KeyValue label="状态" value={detail.deletion.status === "pending" ? "处理中" : "已完成"} />
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
	);
}

export function UserDetailAccountActions({
	commandPending,
	detail,
	onIssueTemporaryPassword,
	onReasonChange,
	onRequestReasonedAction,
	onStartCommand,
	reason,
}: {
	commandPending: boolean;
	detail: AccountAdminUserDetail;
	onIssueTemporaryPassword: () => void;
	onReasonChange: (reason: string) => void;
	onRequestReasonedAction: (
		action: ReasonedAction,
		title: string,
		description: string,
		confirmLabel: string,
	) => void;
	onStartCommand: (action: StandardAction, payload: StandardCommandAttempt["payload"]) => void;
	reason: string;
}) {
	const deletionInProgress = detail.state === "deleting";
	return (
		<Card>
			<CardHeader>
				<CardTitle>账号操作</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-4">
				<Field label="操作原因">
					<Input
						className="min-h-10"
						id="account-admin-reason"
						name="reason"
						onChange={(event) => onReasonChange(event.target.value)}
						value={reason}
					/>
				</Field>
				<ActionGroup>
					<Button
						disabled={deletionInProgress || commandPending}
						onClick={() => onStartCommand("password-reset-email", {})}
						variant="secondary"
					>
						<Mail className="size-4" />
						发送重置邮件
					</Button>
					<Button
						disabled={deletionInProgress || detail.emailVerified || commandPending}
						onClick={() => onStartCommand("verification-email", {})}
						variant="secondary"
					>
						<ShieldCheck className="size-4" />
						发送验证邮件
					</Button>
					<Button
						disabled={!reason.trim() || deletionInProgress || commandPending}
						onClick={onIssueTemporaryPassword}
						variant="secondary"
					>
						<KeyRound className="size-4" />
						签发临时密码
					</Button>
					<Button
						disabled={!reason.trim() || deletionInProgress || commandPending}
						onClick={() =>
							onRequestReasonedAction(
								"sessions-revoke-all",
								"撤销全部会话",
								"该用户当前的全部会话将立即失效，需要重新登录。",
								"确认撤销",
							)
						}
						variant="secondary"
					>
						<ShieldX className="size-4" />
						撤销全部会话
					</Button>
					{detail.state === "banned" ? (
						<Button
							disabled={!reason.trim() || commandPending}
							onClick={() =>
								onRequestReasonedAction(
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
								onRequestReasonedAction(
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
				</ActionGroup>
			</CardContent>
		</Card>
	);
}

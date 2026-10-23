import { Button, StateMessage } from "@campus-agent/ui";
import type { TemporaryPasswordResponse } from "campus-contracts/account-admin";
import { RefreshCw, X } from "lucide-react";
import { formatTimestamp } from "./format";
import { CopyableValue, InlineError } from "./ops-display";
import type { RetryableAttempt } from "./user-detail-model";

export function UserDetailCommandFeedback({
	commandError,
	commandNotice,
	commandPending,
	onDismissTemporaryPassword,
	onRetry,
	retryableAttempt,
	temporaryPassword,
}: {
	commandError: unknown;
	commandNotice: string | null;
	commandPending: boolean;
	onDismissTemporaryPassword: () => void;
	onRetry: () => void;
	retryableAttempt: RetryableAttempt | null;
	temporaryPassword: TemporaryPasswordResponse | undefined;
}) {
	return (
		<>
			{commandError ? (
				<div className="mb-4 grid gap-2">
					<InlineError error={commandError} title="用户操作失败" />
					{retryableAttempt ? (
						<div>
							<Button disabled={commandPending} onClick={onRetry} variant="secondary">
								<RefreshCw className="size-4" />
								重试同一操作
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			{commandNotice ? (
				<StateMessage
					layout="inline"
					role="status"
					className="mb-4 rounded-md border border-success/20 bg-success-subtle px-3 py-2"
					description={commandNotice}
				/>
			) : null}
			{commandPending ? (
				<StateMessage
					layout="inline"
					role="status"
					className="mb-4"
					description={<>正在执行账号操作...</>}
				/>
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
						<Button aria-label="关闭临时密码" onClick={onDismissTemporaryPassword} variant="ghost">
							<X className="size-4" />
						</Button>
					</div>
					<CopyableValue label="临时密码" value={temporaryPassword.temporaryPassword} />
				</div>
			) : null}
		</>
	);
}

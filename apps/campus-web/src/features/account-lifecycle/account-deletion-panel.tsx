import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	ConfirmDialog,
	Field,
	Input,
} from "@campus-agent/ui";
import { CircleAlert } from "lucide-react";
import { useState } from "react";

import { type AccountDeletionReceipt, requestAccountDeletion } from "./api";

export function AccountDeletionPanel({
	requestDeletion = requestAccountDeletion,
	onAccepted,
}: {
	requestDeletion?: typeof requestAccountDeletion;
	onAccepted: (receipt: AccountDeletionReceipt) => void;
}) {
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setPending(true);
		setError(null);
		try {
			const receipt = await requestDeletion(password);
			setOpen(false);
			setPassword("");
			onAccepted(receipt);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "账号注销请求未完成，请稍后重试。");
		} finally {
			setPending(false);
		}
	}

	return (
		<section
			aria-labelledby="account-deletion-heading"
			className="mx-auto mt-8 w-full max-w-[var(--layout-page-form-width)] border-t border-border pt-8"
		>
			<h2 className="text-lg font-semibold" id="account-deletion-heading">
				注销账号
			</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				注销受理后将停止登录并撤下食堂投稿，后台清理聊天记录、个人记忆、投稿与照片及账号关联数据。此操作无法撤销。
			</p>
			{error && !open ? (
				<Alert className="mt-4" tone="danger">
					<CircleAlert className="size-4" />
					<AlertTitle>注销请求未完成</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title="确认注销账号？"
				description="请输入当前密码确认。提交后账号会立即退出，数据清理完成后无法恢复。"
				confirmLabel="确认注销"
				pendingLabel="正在提交"
				pending={pending}
				confirmDisabled={!password}
				onConfirm={() => void submit()}
				error={error}
				formId="account-deletion-confirm"
				trigger={
					<Button className="mt-4" variant="destructive">
						注销账号
					</Button>
				}
			>
				<Field label="当前密码">
					<Input
						form="account-deletion-confirm"
						autoComplete="current-password"
						onChange={(event) => setPassword(event.target.value)}
						required
						type="password"
						value={password}
					/>
				</Field>
			</ConfirmDialog>
		</section>
	);
}

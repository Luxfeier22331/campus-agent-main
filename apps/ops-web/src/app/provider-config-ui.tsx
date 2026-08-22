import {
	Alert,
	Badge,
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@campus-agent/ui";
import { useBlocker } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ModelSettingLatestValidation } from "../shared/ops-contract";
import { formatTimestamp } from "./format";

export const executionModelSettingsQueryKey = ["ops", "model-configs"] as const;

type LatestValidation = ModelSettingLatestValidation | null;

export function transportLabel(value: string) {
	return (
		{
			chat_completions: "Chat Completions API",
			embeddings: "Embeddings API",
			rerank: "Rerank API",
			responses: "Responses API",
		}[value] ?? value
	);
}

export function ValidationBadge({ validation }: { validation: LatestValidation }) {
	if (!validation) {
		return <Badge tone="warning">未验证</Badge>;
	}
	return (
		<Badge tone={validation.status === "passed" ? "success" : "danger"}>
			{validation.status === "passed" ? "验证通过" : "验证失败"}
		</Badge>
	);
}

export function validationDetail(validation: LatestValidation) {
	if (!validation) {
		return "暂无验证记录";
	}
	if (validation.status === "passed") {
		const dimension = validation.observedDimensions
			? `，观测维度 ${validation.observedDimensions}`
			: "";
		return `${formatTimestamp(validation.validatedAt)}${dimension}`;
	}
	return `${validationErrorLabel(validation.errorCode)} · ${formatTimestamp(validation.validatedAt)}`;
}

function validationErrorLabel(errorCode: string | undefined) {
	return (
		{
			invalid_response: "供应商响应格式不正确",
			invalid_setting: "在线模型配置无效",
			provider_unavailable: "无法连接供应商",
			provider_timeout: "供应商验证超时",
		}[errorCode ?? ""] ?? "验证未通过"
	);
}

export function InlineNotice({
	children,
	tone = "success",
}: {
	children: ReactNode;
	tone?: "success" | "warning";
}) {
	return (
		<Alert className="px-3 py-2" role="status" tone={tone}>
			{children}
		</Alert>
	);
}

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
	const blocker = useBlocker({
		disabled: !dirty,
		enableBeforeUnload: dirty,
		shouldBlockFn: () => dirty,
		withResolver: true,
	});
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open && blocker.status === "blocked") {
					blocker.reset();
				}
			}}
			open={blocker.status === "blocked"}
		>
			<DialogContent className="max-w-md" showCloseButton={false}>
				<DialogTitle>有未保存的更改</DialogTitle>
				<DialogDescription>离开此页面将丢失尚未保存的模型配置。</DialogDescription>
				<DialogFooter>
					<DialogClose asChild>
						<Button autoFocus variant="outline">
							继续编辑
						</Button>
					</DialogClose>
					<Button
						onClick={() => {
							if (blocker.status === "blocked") {
								blocker.proceed();
							}
						}}
					>
						放弃修改并离开
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

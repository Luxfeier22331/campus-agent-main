"use client";

import {
	type ToolApprovalOption,
	type ToolCallMessagePart,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
	type ToolCallMessagePartStatus,
	useToolCallElapsed,
} from "@assistant-ui/react";
import { AlertCircleIcon, CheckIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
	"requires-action": AlertCircleIcon,
	complete: CheckIcon,
	incomplete: XCircleIcon,
	running: LoaderIcon,
};

const APPROVED_RESULT = "用户已批准";
const DENIED_RESULT = "用户已拒绝工具执行";

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
	"allow-always": "始终允许",
	"allow-once": "允许",
	"reject-always": "始终拒绝",
	"reject-once": "拒绝",
};

function formatToolDuration(ms: number) {
	if (ms < 1000) {
		return "<1s";
	}
	const seconds = ms / 1000;
	if (seconds < 10) {
		return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
	}
	if (seconds < 60) {
		return `${Math.floor(seconds)}s`;
	}
	return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function ToolFallbackDuration({ className, ...props }: React.ComponentProps<"span">) {
	const elapsedMs = useToolCallElapsed();
	if (elapsedMs === undefined) {
		return null;
	}

	return (
		<span
			className={cn("text-muted-foreground text-xs tabular-nums", className)}
			data-slot="tool-fallback-duration"
			{...props}
		>
			{formatToolDuration(elapsedMs)}
		</span>
	);
}

function ToolFallbackStatus({
	className,
	status,
	toolName,
	...props
}: React.ComponentProps<"div"> & {
	status?: ToolCallMessagePartStatus;
	toolName: string;
}) {
	const statusType = status?.type ?? "complete";
	const isRunning = statusType === "running";
	const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
	const Icon = statusIconMap[statusType];
	const label = isCancelled
		? "操作已取消"
		: statusType === "running"
			? "正在处理"
			: statusType === "requires-action"
				? "需要确认"
				: statusType === "incomplete"
					? "操作没有完成"
					: "已处理";

	return (
		<div
			className={cn("flex w-fit items-center gap-2 py-1 text-muted-foreground text-sm", className)}
			data-slot="tool-fallback-status"
			{...props}
		>
			<Icon className={cn("size-4 shrink-0", isRunning && "animate-spin")} />
			<span className={cn("leading-none", isCancelled && "line-through")}>{label}</span>
			<span className="sr-only">{toolName}</span>
			<ToolFallbackDuration />
		</div>
	);
}

function ToolFallbackError({
	className,
	status,
	...props
}: React.ComponentProps<"p"> & {
	status?: ToolCallMessagePartStatus;
}) {
	if (status?.type !== "incomplete") {
		return null;
	}

	const error = status.error;
	const errorText = error ? (typeof error === "string" ? error : JSON.stringify(error)) : null;
	const message = status.reason === "cancelled" ? "操作已取消。" : "操作没有完成。";

	return (
		<p
			className={cn("text-muted-foreground text-sm", className)}
			data-slot="tool-fallback-error"
			{...props}
		>
			{message}
			{errorText ? <span className="sr-only">{errorText}</span> : null}
		</p>
	);
}

const isAllowKind = (kind: string) => kind === "allow-once" || kind === "allow-always";

const approvalOptionLabel = (option: ToolApprovalOption) =>
	option.label ??
	(Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind)
		? APPROVAL_OPTION_DEFAULT_LABELS[option.kind]
		: undefined) ??
	option.id;

function ToolFallbackApproval({
	addResult,
	approval,
	className,
	interrupt,
	respondToApproval,
	resume,
	...props
}: React.ComponentProps<"div"> &
	Partial<Pick<ToolCallMessagePartProps, "addResult" | "respondToApproval" | "resume">> & {
		approval?: ToolCallMessagePart["approval"];
		interrupt?: ToolCallMessagePart["interrupt"];
	}) {
	const [submitted, setSubmitted] = useState(false);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);

	if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined)) {
		return null;
	}

	const declaredOptions = respondToApproval ? approval?.options : undefined;
	const options = declaredOptions?.filter((option) =>
		Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind),
	);

	const respond = (approved: boolean) => {
		if (submitted) {
			return;
		}
		if (approval != null && approval.approved === undefined && respondToApproval) {
			respondToApproval({ approved });
		} else if (interrupt) {
			resume?.({ approved });
		} else {
			addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT);
		}
		setSubmitted(true);
	};

	const respondWithOption = (option: ToolApprovalOption) => {
		if (submitted) {
			return;
		}
		respondToApproval?.({ optionId: option.id });
		setSubmitted(true);
		setConfirmingId(null);
	};

	const handleOption = (option: ToolApprovalOption) => {
		if (option.confirm) {
			setConfirmingId(option.id);
			return;
		}
		respondWithOption(option);
	};

	const confirming = confirmingId == null ? undefined : options?.find((o) => o.id === confirmingId);
	if (confirming) {
		const confirmMeta = typeof confirming.confirm === "object" ? confirming.confirm : undefined;
		const confirmDescription = confirmMeta?.description ?? confirming.description;
		return (
			<div
				className={cn("flex flex-col gap-2 pt-1", className)}
				data-slot="tool-fallback-approval-confirm"
				{...props}
			>
				<p className="font-semibold text-foreground text-sm">
					{confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
				</p>
				{confirmDescription ? (
					<p className="text-muted-foreground text-sm">{confirmDescription}</p>
				) : null}
				<div className="flex items-center gap-2">
					<Button disabled={submitted} onClick={() => respondWithOption(confirming)} size="sm">
						确认
					</Button>
					<Button
						disabled={submitted}
						onClick={() => setConfirmingId(null)}
						size="sm"
						variant="outline"
					>
						返回
					</Button>
				</div>
			</div>
		);
	}

	if (declaredOptions && declaredOptions.length > 0) {
		const allowOptions = options?.filter((option) => isAllowKind(option.kind)) ?? [];
		const rejectOptions = options?.filter((option) => !isAllowKind(option.kind)) ?? [];
		return (
			<div
				className={cn("flex flex-wrap items-center gap-2 pt-1", className)}
				data-slot="tool-fallback-approval"
				{...props}
			>
				{[...allowOptions, ...rejectOptions].map((option) => (
					<Button
						disabled={submitted}
						key={option.id}
						onClick={() => handleOption(option)}
						size="sm"
						variant={option === allowOptions[0] ? "default" : "outline"}
					>
						{approvalOptionLabel(option)}
					</Button>
				))}
				{rejectOptions.length === 0 ? (
					<Button disabled={submitted} onClick={() => respond(false)} size="sm" variant="outline">
						拒绝
					</Button>
				) : null}
			</div>
		);
	}

	return (
		<div
			className={cn("flex items-center gap-2 pt-1", className)}
			data-slot="tool-fallback-approval"
			{...props}
		>
			<Button disabled={submitted} onClick={() => respond(true)} size="sm">
				允许
			</Button>
			<Button disabled={submitted} onClick={() => respond(false)} size="sm" variant="outline">
				拒绝
			</Button>
		</div>
	);
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
	addResult,
	approval,
	interrupt,
	respondToApproval,
	resume,
	status,
	toolName,
}) => {
	const isRequiresAction = status?.type === "requires-action";

	return (
		<div className="w-full" data-slot="tool-fallback">
			<ToolFallbackStatus status={status} toolName={toolName} />
			<div className="flex flex-col gap-2 ps-6 pt-1 pb-2">
				<ToolFallbackError status={status} />
				{isRequiresAction ? (
					<ToolFallbackApproval
						addResult={addResult}
						approval={approval}
						interrupt={interrupt}
						respondToApproval={respondToApproval}
						resume={resume}
					/>
				) : null}
			</div>
		</div>
	);
};

const ToolFallback = memo(ToolFallbackImpl) as ToolCallMessagePartComponent;
ToolFallback.displayName = "ToolFallback";

export { ToolFallback, ToolFallbackApproval, ToolFallbackError, ToolFallbackStatus };

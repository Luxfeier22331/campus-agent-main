"use client";

import {
	type ToolApprovalOption,
	type ToolCallMessagePart,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
	type ToolCallMessagePartStatus,
	useScrollLock,
} from "@assistant-ui/react";
import {
	ActionGroup,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	cn,
} from "@campus-agent/ui";
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";

const ANIMATION_DURATION = 200;

export type ToolFallbackRootProps = Omit<
	React.ComponentProps<typeof Collapsible>,
	"open" | "onOpenChange"
> & {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
};

function ToolFallbackRoot({
	className,
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	defaultOpen = false,
	children,
	...props
}: ToolFallbackRootProps) {
	const collapsibleRef = useRef<HTMLDivElement>(null);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

	const isControlled = controlledOpen !== undefined;
	const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

	const handleOpenChange = useCallback(
		(open: boolean) => {
			lockScroll();
			if (!isControlled) {
				setUncontrolledOpen(open);
			}
			controlledOnOpenChange?.(open);
		},
		[lockScroll, isControlled, controlledOnOpenChange],
	);

	return (
		<Collapsible
			ref={collapsibleRef}
			data-slot="tool-fallback-root"
			open={isOpen}
			onOpenChange={handleOpenChange}
			className={cn("aui-tool-fallback-root group/tool-fallback-root w-full", className)}
			style={
				{
					"--animation-duration": `${ANIMATION_DURATION}ms`,
				} as React.CSSProperties
			}
			{...props}
		>
			{children}
		</Collapsible>
	);
}

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
	running: LoaderIcon,
	complete: CheckIcon,
	incomplete: XCircleIcon,
	"requires-action": AlertCircleIcon,
};

function ToolFallbackTrigger({
	status,
	className,
	...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
	status?: ToolCallMessagePartStatus;
}) {
	const statusType = status?.type ?? "complete";
	const isRunning = statusType === "running";
	const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";

	const Icon = statusIconMap[statusType];
	const label =
		statusType === "running"
			? "正在查找校园资料"
			: statusType === "requires-action"
				? "需要确认资料查询"
				: isCancelled
					? "资料查询已取消"
					: statusType === "incomplete"
						? "资料查询未完成"
						: "已查找校园资料";

	return (
		<CollapsibleTrigger
			data-slot="tool-fallback-trigger"
			className={cn(
				"aui-tool-fallback-trigger group/trigger text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 py-1 text-sm transition-colors",
				className,
			)}
			{...props}
		>
			<Icon
				data-slot="tool-fallback-trigger-icon"
				className={cn(
					"aui-tool-fallback-trigger-icon size-4 shrink-0",
					isCancelled && "text-muted-foreground",
					isRunning && "animate-spin",
				)}
			/>
			<span
				data-slot="tool-fallback-trigger-label"
				className={cn(
					"aui-tool-fallback-trigger-label-wrapper relative inline-block text-start leading-none",
					isCancelled && "text-muted-foreground line-through",
				)}
			>
				<span>{label}</span>
				{isRunning && (
					<span
						aria-hidden
						data-slot="tool-fallback-trigger-shimmer"
						className="aui-tool-fallback-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
					>
						{label}
					</span>
				)}
			</span>
			<ChevronDownIcon
				data-slot="tool-fallback-trigger-chevron"
				className={cn(
					"aui-tool-fallback-trigger-chevron size-4 shrink-0",
					"transition-transform duration-(--animation-duration) ease-out",
					"group-data-[state=closed]/trigger:-rotate-90",
					"group-data-[state=open]/trigger:rotate-0",
				)}
			/>
		</CollapsibleTrigger>
	);
}

function ToolFallbackContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof CollapsibleContent>) {
	return (
		<CollapsibleContent
			data-slot="tool-fallback-content"
			className={cn(
				"aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
				"group/collapsible-content ease-out",
				"data-[state=closed]:animate-collapsible-up",
				"data-[state=open]:animate-collapsible-down",
				"data-[state=closed]:fill-mode-forwards",
				"data-[state=closed]:pointer-events-none",
				"data-[state=open]:duration-(--animation-duration)",
				"data-[state=closed]:duration-(--animation-duration)",
				className,
			)}
			{...props}
		>
			<div className="flex flex-col gap-2 ps-6 pt-1 pb-2">{children}</div>
		</CollapsibleContent>
	);
}

function ToolFallbackError({
	status,
	className,
	...props
}: React.ComponentProps<"div"> & {
	status?: ToolCallMessagePartStatus;
}) {
	if (status?.type !== "incomplete") {
		return null;
	}

	const isCancelled = status.reason === "cancelled";

	return (
		<div
			data-slot="tool-fallback-error"
			className={cn("aui-tool-fallback-error", className)}
			{...props}
		>
			<p className="aui-tool-fallback-error-reason text-muted-foreground">
				{isCancelled ? "资料查询已取消。" : "资料查询未完成，请查看回答或稍后重试。"}
			</p>
		</div>
	);
}

const APPROVED_RESULT = "用户已允许";
const DENIED_RESULT = "用户已拒绝工具执行";

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
	"allow-once": "允许",
	"allow-always": "始终允许",
	"reject-once": "拒绝",
	"reject-always": "始终拒绝",
};

const isAllowKind = (kind: string) => kind === "allow-once" || kind === "allow-always";

const approvalOptionLabel = (option: ToolApprovalOption) =>
	option.label ??
	(Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind)
		? APPROVAL_OPTION_DEFAULT_LABELS[option.kind]
		: undefined) ??
	option.id;

function ToolFallbackApproval({
	className,
	addResult,
	resume,
	interrupt,
	approval,
	respondToApproval,
	...props
}: React.ComponentProps<"div"> &
	Partial<Pick<ToolCallMessagePartProps, "addResult" | "resume" | "respondToApproval">> & {
		interrupt?: ToolCallMessagePart["interrupt"];
		approval?: ToolCallMessagePart["approval"];
	}) {
	const [submitted, setSubmitted] = useState(false);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);

	if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined)) {
		return null;
	}

	// Custom (`_`-prefixed) kinds cannot be resolved to a boolean by the kit;
	// hosts using custom kinds render their own bar. A declared option list is
	// a host constraint: the kit never adds an approval path beyond it, but
	// always preserves a refusal path.
	const declaredOptions = respondToApproval ? approval?.options : undefined;
	const options = declaredOptions?.filter((o) =>
		Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, o.kind),
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
		} else {
			respondWithOption(option);
		}
	};

	const confirming = confirmingId == null ? undefined : options?.find((o) => o.id === confirmingId);

	if (confirming) {
		const confirmMeta = typeof confirming.confirm === "object" ? confirming.confirm : undefined;
		const confirmDescription = confirmMeta?.description ?? confirming.description;
		return (
			<div
				data-slot="tool-fallback-approval-confirm"
				className={cn("aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1", className)}
				{...props}
			>
				<p className="aui-tool-fallback-approval-confirm-title font-semibold">
					{confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
				</p>
				{confirmDescription && (
					<p className="aui-tool-fallback-approval-confirm-description text-muted-foreground">
						{confirmDescription}
					</p>
				)}
				{confirming.grants && confirming.grants.length > 0 && (
					<ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
						{confirming.grants.map((grant) => (
							<li key={grant}>
								<code className="aui-tool-fallback-approval-confirm-grant bg-surface-muted rounded px-1.5 py-0.5 text-xs">
									{grant}
								</code>
							</li>
						))}
					</ul>
				)}
				<ActionGroup>
					<Button size="sm" onClick={() => respondWithOption(confirming)} disabled={submitted}>
						确认
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setConfirmingId(null)}
						disabled={submitted}
					>
						返回
					</Button>
				</ActionGroup>
			</div>
		);
	}

	if (declaredOptions && declaredOptions.length > 0) {
		const allowOptions = options?.filter((o) => isAllowKind(o.kind)) ?? [];
		const rejectOptions = options?.filter((o) => !isAllowKind(o.kind)) ?? [];
		return (
			<div
				data-slot="tool-fallback-approval"
				className={cn(
					"aui-tool-fallback-approval flex flex-wrap items-center gap-2 pt-1",
					className,
				)}
				{...props}
			>
				{[...allowOptions, ...rejectOptions].map((option) => (
					<Button
						key={option.id}
						size="sm"
						variant={option === allowOptions[0] ? "primary" : "outline"}
						onClick={() => handleOption(option)}
						disabled={submitted}
					>
						{approvalOptionLabel(option)}
					</Button>
				))}
				{rejectOptions.length === 0 && (
					<Button size="sm" variant="outline" onClick={() => respond(false)} disabled={submitted}>
						拒绝
					</Button>
				)}
			</div>
		);
	}

	return (
		<div
			data-slot="tool-fallback-approval"
			className={cn("aui-tool-fallback-approval flex items-center gap-2 pt-1", className)}
			{...props}
		>
			<Button size="sm" onClick={() => respond(true)} disabled={submitted}>
				允许
			</Button>
			<Button size="sm" variant="outline" onClick={() => respond(false)} disabled={submitted}>
				拒绝
			</Button>
		</div>
	);
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
	status,
	addResult,
	resume,
	interrupt,
	approval,
	respondToApproval,
}) => {
	const isRequiresAction = status?.type === "requires-action";

	const [open, setOpen] = useState(isRequiresAction);
	const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction);
	if (isRequiresAction !== prevRequiresAction) {
		setPrevRequiresAction(isRequiresAction);
		if (isRequiresAction) {
			setOpen(true);
		}
	}

	return (
		<ToolFallbackRoot open={open} onOpenChange={setOpen}>
			<ToolFallbackTrigger status={status} />
			<ToolFallbackContent>
				<ToolFallbackError status={status} />
				{isRequiresAction && (
					<ToolFallbackApproval
						addResult={addResult}
						resume={resume}
						interrupt={interrupt}
						approval={approval}
						respondToApproval={respondToApproval}
					/>
				)}
			</ToolFallbackContent>
		</ToolFallbackRoot>
	);
};

const ToolFallback = memo(ToolFallbackImpl) as unknown as ToolCallMessagePartComponent & {
	Root: typeof ToolFallbackRoot;
	Trigger: typeof ToolFallbackTrigger;
	Content: typeof ToolFallbackContent;
	Error: typeof ToolFallbackError;
	Approval: typeof ToolFallbackApproval;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Error = ToolFallbackError;
ToolFallback.Approval = ToolFallbackApproval;

export {
	ToolFallback,
	ToolFallbackApproval,
	ToolFallbackContent,
	ToolFallbackError,
	ToolFallbackRoot,
	ToolFallbackTrigger,
};

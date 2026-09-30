import { Alert, Badge, Button, cn, Disclosure, DisclosureSummary } from "@campus-agent/ui";
import { Check, CircleAlert, Clipboard, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { OpsHealthStatus, OpsRequestSummary } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { OpsApiError } from "./ops-api/core";
import { formatStatusLabel } from "./ops-view-helpers";

export function PageHeader({
	actions,
	description,
	title,
	headingLevel = 1,
}: {
	actions?: ReactNode;
	description?: string;
	title: string;
	headingLevel?: 1 | 2;
}) {
	const Heading = headingLevel === 1 ? "h1" : "h2";
	return (
		<div className="ops-page-header mb-5 flex flex-col gap-4 border-border border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
			<div className="min-w-0 space-y-1">
				<Heading className={headingLevel === 1 ? "ui-page-title" : "ui-section-title"}>
					{title}
				</Heading>
				{description ? <p className="ui-supporting max-w-3xl">{description}</p> : null}
			</div>
			{actions ? <div className="ops-page-actions shrink-0">{actions}</div> : null}
		</div>
	);
}

export function PageShell({
	children,
	description,
	title,
}: {
	children: ReactNode;
	description?: string | undefined;
	title: string;
}) {
	return (
		<section>
			<PageHeader {...(description ? { description } : {})} title={title} />
			<div className="py-4 text-muted-foreground text-sm" role="status" aria-live="polite">
				{children}
			</div>
		</section>
	);
}

export function ErrorState({
	error,
	onRetry,
	title,
}: {
	error: unknown;
	onRetry?: () => void;
	title: string;
}) {
	const detail = describeError(error);
	return (
		<Alert className="grid gap-3" tone="danger">
			<div className="grid gap-1">
				<p className="font-semibold">{title}</p>
				<p className="text-sm">{detail.message}</p>
			</div>
			<TechnicalErrorDetails detail={detail} />
			{onRetry ? (
				<div>
					<Button onClick={onRetry} variant="secondary">
						<RefreshCw className="size-4" />
						重试
					</Button>
				</div>
			) : null}
		</Alert>
	);
}

export function InlineError({ error, title }: { error: unknown; title: string }) {
	const detail = describeError(error);
	return (
		<Alert tone="danger">
			<p className="font-medium">{title}</p>
			<p className="mt-1 text-xs">{detail.message}</p>
			<TechnicalErrorDetails className="mt-2" detail={detail} />
		</Alert>
	);
}

export function StaleDataWarning({
	error,
	lastSuccessfulAt,
	onRetry,
	title,
}: {
	error: unknown;
	lastSuccessfulAt: number;
	onRetry: () => void;
	title: string;
}) {
	const detail = describeError(error);
	return (
		<Alert
			className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
			tone="warning"
		>
			<div className="grid gap-1 text-sm">
				<p className="font-medium">{title}</p>
				<p className="text-muted-foreground text-xs">
					仍显示最后一次成功数据（{formatTimestamp(new Date(lastSuccessfulAt).toISOString())}）。
					数据可能已经过期。{detail.message}
				</p>
				<TechnicalErrorDetails detail={detail} />
			</div>
			<Button onClick={onRetry} variant="secondary">
				<RefreshCw className="size-4" />
				重试刷新
			</Button>
		</Alert>
	);
}

function TechnicalErrorDetails({
	className,
	detail,
}: {
	className?: string;
	detail: ReturnType<typeof describeError>;
}) {
	return (
		<Disclosure className={cn("text-xs", className)}>
			<DisclosureSummary className="w-fit font-medium text-current">技术信息</DisclosureSummary>
			<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
				<Badge tone="danger">{detail.status}</Badge>
				<span>{detail.code}</span>
				{detail.reasonCode ? <span className="text-warning">原因：{detail.reasonCode}</span> : null}
			</div>
			{detail.details ? (
				<pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-current/20 bg-background p-2 font-mono text-current text-xs">
					{detail.details}
				</pre>
			) : null}
		</Disclosure>
	);
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="grid min-h-11 min-w-0 content-center gap-1 border-border border-b py-2 last:border-b-0">
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			<span className="min-w-0 break-words text-foreground">{value}</span>
		</div>
	);
}

export function CopyableValue({
	compact = false,
	contextLabel,
	label,
	value,
}: {
	compact?: boolean;
	contextLabel?: string | undefined;
	label: string;
	value: string | null;
}) {
	const [copyStatus, setCopyStatus] = useCopyStatus();
	const displayValue = value ?? "未关联";
	const canCopy = Boolean(value);
	const statusText =
		copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "复制失败" : null;

	return (
		<div className={compact ? "grid min-w-0 gap-1" : "grid min-w-0 gap-2"}>
			{compact ? <span className="font-medium text-muted-foreground text-xs">{label}</span> : null}
			<div className="flex min-w-0 items-center justify-between gap-2">
				<span
					className={cn(
						"min-w-0 truncate font-mono text-xs",
						compact ? "text-muted-foreground" : "text-foreground",
					)}
					title={value ?? undefined}
				>
					{displayValue}
				</span>
				<Button
					aria-label={copyButtonLabel(label, contextLabel)}
					className={cn(
						"size-11 shrink-0 p-0",
						copyStatus === "failed" && "text-danger",
						copyStatus === "copied" && "text-success",
					)}
					data-copy-status={copyStatus}
					disabled={!canCopy}
					onClick={async () => {
						if (!value) {
							return;
						}
						try {
							await navigator.clipboard.writeText(value);
							setCopyStatus("copied");
						} catch {
							setCopyStatus("failed");
						}
					}}
					title={statusText ?? copyButtonLabel(label, contextLabel)}
					variant="ghost"
				>
					<CopyStatusIcon status={copyStatus} />
				</Button>
			</div>
			<span aria-live="polite" className="sr-only">
				{statusText ?? ""}
			</span>
		</div>
	);
}

export function CopyIconButton({
	contextLabel,
	label,
	value,
}: {
	contextLabel?: string;
	label: string;
	value: string;
}) {
	const [copyStatus, setCopyStatus] = useCopyStatus();
	const statusText =
		copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "复制失败" : null;
	return (
		<div className="shrink-0">
			<Button
				aria-label={copyButtonLabel(label, contextLabel)}
				className={cn(
					"size-11 p-0",
					copyStatus === "failed" && "text-danger",
					copyStatus === "copied" && "text-success",
				)}
				data-copy-status={copyStatus}
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
						setCopyStatus("copied");
					} catch {
						setCopyStatus("failed");
					}
				}}
				title={statusText ?? copyButtonLabel(label, contextLabel)}
				variant="ghost"
			>
				<CopyStatusIcon status={copyStatus} />
			</Button>
			<span aria-live="polite" className="sr-only">
				{statusText ?? ""}
			</span>
		</div>
	);
}

function useCopyStatus() {
	const [status, setStatus] = useState<"copied" | "failed" | "idle">("idle");
	useEffect(() => {
		if (status === "idle") {
			return;
		}
		const timeoutId = window.setTimeout(() => setStatus("idle"), 1600);
		return () => window.clearTimeout(timeoutId);
	}, [status]);
	return [status, setStatus] as const;
}

function copyButtonLabel(label: string, contextLabel: string | undefined) {
	return contextLabel ? `复制 ${contextLabel} 的 ${label}` : `复制 ${label}`;
}

function CopyStatusIcon({ status }: { status: "copied" | "failed" | "idle" }) {
	if (status === "copied") {
		return <Check className="size-4" />;
	}
	if (status === "failed") {
		return <CircleAlert className="size-4" />;
	}
	return <Clipboard className="size-4" />;
}

type DisplayStatus = OpsHealthStatus | OpsRequestSummary["status"];

const STATUS_TONES = {
	ACTION_REQUIRED: "warning",
	CANCELLED: "neutral",
	COMPLETED: "success",
	DEGRADED: "warning",
	FAILED: "danger",
	HEALTHY: "success",
	OUTAGE: "danger",
	PENDING: "neutral",
	RUNNING: "info",
	UNKNOWN: "neutral",
} as const satisfies Record<DisplayStatus, React.ComponentProps<typeof Badge>["tone"]>;

export function StatusBadge({ status }: { status: DisplayStatus }) {
	return (
		<Badge tone={STATUS_TONES[status]}>
			<span title={formatStatusLabel(status) === status ? undefined : status}>
				{formatStatusLabel(status)}
			</span>
		</Badge>
	);
}

export function formatIssueSeverity(severity: "CRITICAL" | "INFO" | "WARNING") {
	return { CRITICAL: "严重", INFO: "提示", WARNING: "警告" }[severity];
}

export function describeError(error: unknown) {
	if (error instanceof OpsApiError) {
		const details = formatErrorDetails(error.details);
		return {
			code: error.code,
			details,
			message: error.message,
			reasonCode: error.reasonCode,
			status: `HTTP ${error.status}`,
		};
	}
	if (error instanceof Error) {
		return {
			code: "CLIENT_ERROR",
			details: null,
			message: error.message,
			reasonCode: undefined,
			status: "client",
		};
	}
	return {
		code: "UNKNOWN_ERROR",
		details: null,
		message: "未知错误。",
		reasonCode: undefined,
		status: "unknown",
	};
}

function formatErrorDetails(details: Record<string, unknown>): string | null {
	const entries = Object.entries(details).filter((entry) => entry[1] !== undefined);
	if (entries.length === 0) {
		return null;
	}
	return JSON.stringify(Object.fromEntries(entries), null, 2);
}

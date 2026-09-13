import { Button, Checkbox, Field, NativeSelect } from "@campus-agent/ui";
import { useState } from "react";
import type {
	NoticeAutomation,
	NoticeAutomationInput,
} from "../../shared/notice-automation-contract";
import type { NoticeJob } from "../../shared/ops-contract";
import { formatTimestamp } from "../format";
import { InlineError } from "../ops-display";
import { NoticeJobStatusBadge } from "./notice-status";

export function NoticeAutomationPanel({
	data,
	error,
	saving,
	saveError,
	busy,
	latest,
	onSave,
	onRun,
	onTasks,
	onRetry,
}: {
	data: NoticeAutomation | undefined;
	error: unknown;
	saving: boolean;
	saveError: unknown;
	busy: boolean;
	latest: NoticeJob | undefined;
	onSave: (value: NoticeAutomationInput) => Promise<unknown>;
	onRun: () => void;
	onTasks: () => void;
	onRetry: () => void;
}) {
	const [draft, setDraft] = useState<NoticeAutomationInput | null>(null);
	const value = draft ?? {
		enabled: data?.enabled ?? false,
		intervalMinutes: data?.intervalMinutes ?? 15,
	};
	const editable = Boolean(data?.supported && data.enabled !== null);
	return (
		<section aria-label="自动采集" className="mb-5 grid gap-3 rounded-lg border p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-medium">自动采集</h2>
				<p className="text-sm" aria-live="polite">
					{data
						? data.supported
							? data.enabled === null
								? "状态暂不可用"
								: data.enabled
									? `已开启${data.intervalMinutes ? ` · 每 ${data.intervalMinutes} 分钟` : " · 频率未配置"}`
									: "已暂停"
							: "本地环境不运行定时采集"
						: error
							? "状态暂不可用"
							: "正在读取…"}
				</p>
			</div>
			{error ? <InlineError error={error} title="自动采集读取失败" /> : null}
			{data?.scheduleError ? (
				<p role="alert" className="text-sm text-danger">
					{data.scheduleError}
				</p>
			) : null}
			{error || data?.scheduleError ? (
				<Button onClick={onRetry} variant="outline">
					重试
				</Button>
			) : null}
			{data?.supported ? (
				<form
					className="flex flex-wrap items-end gap-3"
					onSubmit={async (event) => {
						event.preventDefault();
						try {
							await onSave(value);
							setDraft(null);
						} catch {
							/* Keep the draft and show the mutation error. */
						}
					}}
				>
					<label
						htmlFor="notice-automation-enabled"
						className="flex min-h-11 items-center gap-2 text-sm"
					>
						<Checkbox
							id="notice-automation-enabled"
							role="switch"
							aria-checked={value.enabled}
							checked={value.enabled}
							disabled={!editable || saving}
							onCheckedChange={(checked) => setDraft({ ...value, enabled: checked === true })}
						/>
						启用自动采集
					</label>
					<Field label="采集频率">
						<NativeSelect
							value={value.intervalMinutes}
							disabled={!editable || saving}
							onChange={(event) =>
								setDraft({ ...value, intervalMinutes: Number(event.target.value) as 15 | 30 | 60 })
							}
						>
							{[15, 30, 60].map((minutes) => (
								<option value={minutes} key={minutes}>
									每 {minutes} 分钟
								</option>
							))}
						</NativeSelect>
					</Field>
					<Button
						type="submit"
						disabled={!editable || saving || (!draft && data.intervalMinutes !== null)}
					>
						{saving ? "保存中…" : "保存设置"}
					</Button>
				</form>
			) : null}
			{saveError ? <InlineError error={saveError} title="设置保存失败" /> : null}
			<div className="flex flex-wrap items-center gap-3 text-sm">
				<span>
					最近自动成功：
					{data?.scheduleError
						? "暂不可用"
						: data?.lastSuccessfulTime
							? formatTimestamp(data.lastSuccessfulTime)
							: "暂无记录"}
				</span>
				{latest ? (
					<span className="flex items-center gap-2">
						最近采集
						<NoticeJobStatusBadge status={latest.status} />
					</span>
				) : null}
			</div>
			<p className="text-sm text-muted-foreground">
				已扫描范围：
				{data?.stateError
					? "暂不可用"
					: data?.maintenanceRange
						? `${data.maintenanceRange.from} 至 ${previousDate(data.maintenanceRange.to)}`
						: "尚未初始化"}
			</p>
			{data?.stateError ? (
				<p role="alert" className="text-sm">
					{data.stateError}
				</p>
			) : null}
			<p className="text-sm">
				门户凭据：
				{data?.credentialAvailable === true
					? "可用"
					: data?.credentialAvailable === false
						? "无可用凭据"
						: "状态暂不可用"}{" "}
				·{" "}
				<a href="/internal-portal" className="text-link underline">
					管理凭据
				</a>
			</p>
			{data?.credentialError ? (
				<p role="alert" className="text-sm">
					{data.credentialError}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button onClick={onRun} disabled={busy} variant="outline">
					立即采集
				</Button>
				<Button onClick={onTasks} variant="ghost">
					查看任务
				</Button>
			</div>
		</section>
	);
}
function previousDate(value: string) {
	const date = new Date(`${value}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}

import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { StatusBadge } from "./ops-display";

export function StepMobileList({ steps }: { steps: OpsRequestDetailResponse["stepTrajectory"] }) {
	return (
		<div className="grid gap-3 md:hidden" data-testid="step-mobile-list">
			{steps.map((step) => (
				<div
					className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm"
					data-testid="step-mobile-card"
					key={step.stepId}
				>
					<div className="flex min-w-0 items-start justify-between gap-3">
						<div className="grid min-w-0 gap-1">
							<StatusBadge status={step.status} />
							<span className="break-all font-semibold text-slate-950">{step.stepId}</span>
						</div>
						<span className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 text-xs">
							重试 {step.retryCount} 次
						</span>
					</div>
					<div className="grid gap-1 text-slate-600 text-xs">
						<span>
							类型：<span className="break-all text-slate-950">{step.spanKind}</span>
						</span>
						<span>
							工具：<span className="break-all text-slate-950">{step.toolName ?? "无"}</span>
						</span>
						<span>
							上一步：<span className="break-all text-slate-950">{step.parentStepId ?? "无"}</span>
						</span>
						<span>结果状态：{step.resultStatus ?? "未记录"}</span>
					</div>
					<p className="break-words rounded-md bg-slate-50 p-2 text-slate-700">
						{step.outcome ?? "未记录结果"}
					</p>
				</div>
			))}
		</div>
	);
}

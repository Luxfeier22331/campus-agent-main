import "./handbook-flow-graph.css";
import type {
	HandbookFlow,
	HandbookFlowGraphDocumentData,
	HandbookFlowStep,
} from "./handbook-flow-graph-types";

interface Props {
	data: HandbookFlowGraphDocumentData;
}

const STATUS_LABELS = {
	ready: "内容已可阅读",
	needs_review: "等待内容复核",
} as const;

interface FlowListItem {
	flow: HandbookFlow;
	flowIndex: number;
	sourcePage: number;
}

function countFlows(data: HandbookFlowGraphDocumentData): number {
	return data.pageFindings.reduce((total, page) => total + page.flows.length, 0);
}

function countSteps(data: HandbookFlowGraphDocumentData): number {
	return data.pageFindings.reduce(
		(total, page) =>
			total + page.flows.reduce((flowTotal, flow) => flowTotal + flow.steps.length, 0),
		0,
	);
}

function getSourcePageRange(data: HandbookFlowGraphDocumentData): string {
	if (data.sourcePageStart === data.sourcePageEnd) {
		return `第 ${data.sourcePageStart} 页`;
	}
	return `第 ${data.sourcePageStart}-${data.sourcePageEnd} 页`;
}

function getFlowAnchor(flowIndex: number): string {
	return `flow-${flowIndex + 1}`;
}

function getPageHeadingAnchor(sourcePage: number): string {
	return `source-page-${sourcePage}`;
}

function flattenFlows(data: HandbookFlowGraphDocumentData): FlowListItem[] {
	const items: FlowListItem[] = [];
	data.pageFindings.forEach((page) => {
		page.flows.forEach((flow) => {
			items.push({
				flow,
				flowIndex: items.length,
				sourcePage: page.sourcePage,
			});
		});
	});
	return items;
}

function formatItemNumber(index: number): string {
	return String(index + 1).padStart(2, "0");
}

function buildStepHint({
	step,
	flow,
	stepIndex,
}: {
	step: HandbookFlowStep;
	flow: HandbookFlow;
	stepIndex: number;
}): string | null {
	if (step.nextStepIds.length === 0) {
		return "到此办结";
	}
	const nextSequentialStep = flow.steps[stepIndex + 1]?.stepId;
	if (step.nextStepIds.length === 1 && step.nextStepIds[0] === nextSequentialStep) {
		return null;
	}
	const stepNumberById = new Map(
		flow.steps.map((candidate, index) => [candidate.stepId, `第 ${index + 1} 步`]),
	);
	return `后续转到：${step.nextStepIds
		.map((stepId) => stepNumberById.get(stepId) ?? stepId)
		.join("、")}`;
}

function HandbookFlowCard({
	flow,
	flowIndex,
	sourcePage,
}: {
	flow: HandbookFlow;
	flowIndex: number;
	sourcePage: number;
}) {
	const headingId = getFlowAnchor(flowIndex);

	return (
		<article className="handbook-flow-card" aria-labelledby={headingId}>
			<header className="handbook-flow-card-header">
				<p className="handbook-flow-card-kicker">事项 {formatItemNumber(flowIndex)}</p>
				<h3 className="rp-toc-include" id={headingId}>
					{flow.flowHeading}
				</h3>
				<div className="handbook-flow-card-meta" aria-label="流程信息">
					{flow.audienceScope ? <span>{flow.audienceScope}</span> : null}
					<span>{flow.steps.length} 步</span>
					<span>原文第 {sourcePage} 页</span>
				</div>
			</header>
			<ol className="handbook-flow-step-list">
				{flow.steps.map((step, index) => {
					const stepHint = buildStepHint({ step, flow, stepIndex: index });
					return (
						<li
							key={`${step.stepId || index}-${step.stepText}`}
							className={`handbook-flow-step${step.nextStepIds.length === 0 ? " is-final" : ""}`}
						>
							<span className="handbook-flow-step-index">{index + 1}</span>
							<div className="handbook-flow-step-body">
								<p>{step.stepText}</p>
								{stepHint ? <span className="handbook-flow-step-hint">{stepHint}</span> : null}
							</div>
						</li>
					);
				})}
			</ol>
			{flow.manualReviewNotes.length > 0 ? (
				<section className="handbook-flow-notes">
					<h5>复核提示</h5>
					<ul>
						{flow.manualReviewNotes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</section>
			) : null}
		</article>
	);
}

export default function HandbookFlowGraphSection({ data }: Props) {
	if (data.pageFindings.length === 0) {
		return null;
	}
	const flowCount = countFlows(data);
	const stepCount = countSteps(data);
	const flowItems = flattenFlows(data);
	const flowIndexByFlow = new Map(flowItems.map((item) => [item.flow, item.flowIndex]));

	return (
		<section className={`handbook-flow-shell status-${data.extractionStatus}`}>
			<header className="handbook-flow-hero">
				<div className="handbook-flow-hero-copy">
					<p className="handbook-flow-eyebrow">学生公寓服务</p>
					<h2 className="rp-toc-include" id="flow-guide">
						按住宿场景办理
					</h2>
					<p className="handbook-flow-lede">
						新生入住、毕业离校、不住宿申请和退宿流程分开呈现。先找到与你身份相符的事项，再按顺序准备材料、完成签字盖章和后续办理。
					</p>
					<div className="handbook-flow-source-list" aria-label="来源信息">
						<span>{data.sourceHandbookSection}</span>
						<span>学生手册 {getSourcePageRange(data)}</span>
					</div>
				</div>
				<dl className="handbook-flow-summary" aria-label="页面概览">
					<div>
						<dt>事项</dt>
						<dd>{flowCount}</dd>
					</div>
					<div>
						<dt>步骤</dt>
						<dd>{stepCount}</dd>
					</div>
					<div>
						<dt>状态</dt>
						<dd>{STATUS_LABELS[data.extractionStatus]}</dd>
					</div>
				</dl>
			</header>

			<nav aria-label="选择办理事项" className="handbook-flow-chooser">
				<header className="handbook-flow-chooser-header">
					<div>
						<p>办理前先确认</p>
						<h3 className="rp-toc-include" id="flow-task-index">
							你要办理哪一类住宿事项？
						</h3>
					</div>
					<span>不确定时，优先按身份标签选择。</span>
				</header>
				<ol className="handbook-flow-task-list">
					{flowItems.map(({ flow, flowIndex, sourcePage }) => {
						const taskMeta = [
							flow.audienceScope,
							`${flow.steps.length} 步`,
							`原文第 ${sourcePage} 页`,
						].filter(Boolean);
						return (
							<li key={`${sourcePage}-${flow.flowHeading}-${flowIndex}`}>
								<a className="handbook-flow-task-link" href={`#${getFlowAnchor(flowIndex)}`}>
									<span className="handbook-flow-task-number">{formatItemNumber(flowIndex)}</span>
									<span className="handbook-flow-task-copy">
										<strong>{flow.flowHeading}</strong>
										<small>{taskMeta.join(" / ")}</small>
									</span>
									<span className="handbook-flow-task-action">查看步骤</span>
								</a>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="handbook-flow-page-list">
				{data.pageFindings.map((page) => (
					<section key={page.sourcePage} className="handbook-flow-page">
						<header className="handbook-flow-page-header">
							<p>原文第 {page.sourcePage} 页</p>
							{page.pageHeading && page.pageHeading !== data.title ? (
								<h3 className="rp-toc-include" id={getPageHeadingAnchor(page.sourcePage)}>
									{page.pageHeading}
								</h3>
							) : null}
						</header>
						<div className="handbook-flow-card-list">
							{page.flows.map((flow) => (
								<HandbookFlowCard
									key={`${page.sourcePage}-${flow.flowHeading}-${flow.steps
										.map((step) => step.stepId || step.stepText)
										.join("|")}`}
									flow={flow}
									flowIndex={flowIndexByFlow.get(flow) ?? 0}
									sourcePage={page.sourcePage}
								/>
							))}
						</div>
					</section>
				))}
			</div>

			{data.manualReviewRequired ? (
				<section className="handbook-flow-global-note">
					<h3>需要复核</h3>
					<p>上游抽取结果标记为需要复核。当前页面仍按原始结构展示，后续修正应回到上游产物。</p>
				</section>
			) : null}
		</section>
	);
}

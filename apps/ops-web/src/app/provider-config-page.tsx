import { Card, CardContent, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ModelSettingKind } from "../shared/ops-contract";
import { NoticeClassificationForm } from "./notice-classification-form";
import { OcrConfigForm } from "./ocr-config-form";
import { fetchExecutionModelSettings } from "./ops-api/model-settings";
import { ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { ExecutionModelSettingForm } from "./provider-config-form";
import { executionModelSettingsQueryKey, UnsavedChangesGuard } from "./provider-config-ui";

export function ProviderConfigPage() {
	return (
		<section>
			<PageHeader
				description="配置在线运行时、检索重排和通知分类使用的模型连接。"
				title="模型配置"
			/>
			<nav aria-label="模型配置分区" className="mb-5 flex flex-wrap gap-4 text-sm">
				{[
					["generation", "在线生成"],
					["retrieval", "检索模型"],
					["classification", "通知分类"],
					["ocr", "文档识别"],
				].map(([id, label]) => (
					<a
						key={id}
						href={`#model-${id}`}
						className="inline-flex min-h-11 items-center text-link hover:underline"
					>
						{label}
					</a>
				))}
			</nav>
			<ExecutionModelSettings />
			<section id="model-ocr" className="mt-6 min-w-0 scroll-mt-24">
				<OcrConfigForm />
			</section>
		</section>
	);
}

function ExecutionModelSettings() {
	const [dirtyKinds, setDirtyKinds] = useState<Record<ModelSettingKind, boolean>>({
		embedding: false,
		llm: false,
		reranker: false,
	});
	const status = useQuery({
		queryFn: ({ signal }) => fetchExecutionModelSettings({ signal }),
		queryKey: executionModelSettingsQueryKey,
	});
	const onDirtyChange = useCallback((kind: ModelSettingKind, dirty: boolean) => {
		setDirtyKinds((current) => (current[kind] === dirty ? current : { ...current, [kind]: dirty }));
	}, []);
	const dirty = dirtyKinds.llm || dirtyKinds.embedding || dirtyKinds.reranker;

	if (status.isPending) {
		return <LoadingSettings />;
	}
	if (!status.data) {
		return (
			<ErrorState error={status.error} onRetry={() => status.refetch()} title="模型配置读取失败" />
		);
	}
	return (
		<>
			<UnsavedChangesGuard dirty={dirty} />
			{status.isError ? (
				<StaleDataWarning
					error={status.error}
					lastSuccessfulAt={status.dataUpdatedAt}
					onRetry={() => status.refetch()}
					title="模型配置刷新失败"
				/>
			) : null}
			<div className="grid gap-6">
				<section id="model-generation" className="min-w-0 scroll-mt-24 space-y-3">
					<h2 className="ui-section-title">在线生成</h2>
					<ExecutionModelSettingForm
						embeddingContract={status.data.embeddingContract}
						kind="llm"
						onDirtyChange={onDirtyChange}
						setting={status.data.settings.llm}
					/>
				</section>
				<section id="model-retrieval" className="min-w-0 scroll-mt-24 space-y-3">
					<h2 className="ui-section-title">检索模型</h2>
					<div className="grid items-start gap-5 xl:grid-cols-2">
						<ExecutionModelSettingForm
							embeddingContract={status.data.embeddingContract}
							kind="embedding"
							onDirtyChange={onDirtyChange}
							setting={status.data.settings.embedding}
						/>
						<ExecutionModelSettingForm
							embeddingContract={status.data.embeddingContract}
							kind="reranker"
							onDirtyChange={onDirtyChange}
							setting={status.data.settings.reranker}
						/>
					</div>
				</section>
				<section id="model-classification" className="min-w-0 scroll-mt-24 space-y-3">
					<h2 className="ui-section-title">通知分类连接</h2>
					<NoticeClassificationForm settings={status.data.noticeClassification} />
				</section>
			</div>
		</>
	);
}

function LoadingSettings() {
	return (
		<Card>
			<CardContent
				aria-live="polite"
				className="p-4 text-muted-foreground text-sm md:p-5"
				role="status"
			>
				<StateMessage layout="inline" description="正在读取模型配置..." />
			</CardContent>
		</Card>
	);
}

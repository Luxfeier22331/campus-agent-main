import { Card, CardContent } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ModelSettingKind } from "../shared/ops-contract";
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
			<ExecutionModelSettings />
			<OcrConfigForm />
		</section>
	);
}

function ExecutionModelSettings() {
	const [dirtyKinds, setDirtyKinds] = useState<Record<ModelSettingKind, boolean>>({
		embedding: false,
		llm: false,
		reranker: false,
		notice_classifier: false,
	});
	const status = useQuery({
		queryFn: ({ signal }) => fetchExecutionModelSettings({ signal }),
		queryKey: executionModelSettingsQueryKey,
	});
	const onDirtyChange = useCallback((kind: ModelSettingKind, dirty: boolean) => {
		setDirtyKinds((current) => (current[kind] === dirty ? current : { ...current, [kind]: dirty }));
	}, []);
	const dirty =
		dirtyKinds.llm || dirtyKinds.embedding || dirtyKinds.reranker || dirtyKinds.notice_classifier;

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
			<div className="grid gap-4 xl:grid-cols-4">
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="llm"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.llm}
				/>
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
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="notice_classifier"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.notice_classifier}
				/>
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
				正在读取模型配置...
			</CardContent>
		</Card>
	);
}

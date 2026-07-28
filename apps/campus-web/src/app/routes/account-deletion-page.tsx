import { Alert, AlertDescription, AlertTitle, Button } from "@campus-agent/ui";
import { CheckCircle2 } from "lucide-react";

import { ProductBrandLink } from "@/components/navigation/product-navigation";

export function AccountDeletionPage() {
	return (
		<main className="min-h-dvh px-4 py-8 lg:px-8">
			<ProductBrandLink className="mx-auto mb-8 w-full max-w-[var(--layout-page-form-width)]" />
			<Alert className="mx-auto w-full max-w-[var(--layout-page-form-width)]">
				<CheckCircle2 className="size-4" />
				<AlertTitle>注销请求已受理</AlertTitle>
				<AlertDescription>
					账号已停止登录，聊天记录、个人记忆和关联运行数据正在清理。清理完成后无法恢复。
				</AlertDescription>
			</Alert>
			<div className="mx-auto mt-6 w-full max-w-[var(--layout-page-form-width)]">
				<Button asChild>
					<a href="/">返回校园问答</a>
				</Button>
			</div>
		</main>
	);
}

import { Button } from "@campus-agent/ui";
import { Link } from "@tanstack/react-router";
import { PageShell } from "./ops-display";

export function NotFoundPage() {
	return (
		<PageShell title="页面不存在">
			<p className="text-muted-foreground">当前地址不属于运维工作台。</p>
			<div className="mt-4">
				<Button asChild>
					<Link to="/requests">返回运行记录</Link>
				</Button>
			</div>
		</PageShell>
	);
}

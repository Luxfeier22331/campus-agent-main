import { Link } from "@tanstack/react-router";
import { PageShell } from "./ops-display";
import { Button } from "./ui/button";

export function NotFoundPage() {
	return (
		<PageShell title="页面不存在">
			<p className="text-slate-600">当前地址不属于运维工作台。</p>
			<div className="mt-4">
				<Button asChild>
					<Link to="/requests">返回请求列表</Link>
				</Button>
			</div>
		</PageShell>
	);
}

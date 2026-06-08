import { ClipboardList, GitBranch, History, Utensils } from "lucide-react";

const SUMMARY_CARDS = [
	{ icon: Utensils, label: "食堂地图", value: "draft / published" },
	{ icon: GitBranch, label: "发布链路", value: "preview / publish" },
	{ icon: History, label: "审计记录", value: "operator command" },
	{ icon: ClipboardList, label: "采集提案", value: "后续模块" },
] as const;

export function HomePage() {
	return (
		<section className="space-y-6">
			<div className="ops-panel p-6">
				<p className="ops-eyebrow">Campus Operations</p>
				<h2 className="ops-title">运营总览</h2>
				<p className="mt-2 max-w-2xl text-sm text-zinc-600">
					这里承载学生侧校园数据的编辑、预览、发布和审计。第一批先完整落地食堂地图。
				</p>
			</div>
			<div className="grid gap-4 md:grid-cols-4">
				{SUMMARY_CARDS.map((card) => {
					const Icon = card.icon;
					return (
						<div className="ops-panel p-5" key={card.label}>
							<Icon aria-hidden="true" className="size-5 text-zinc-500" />
							<h3 className="mt-4 font-semibold text-base">{card.label}</h3>
							<p className="mt-1 text-sm text-zinc-500">{card.value}</p>
						</div>
					);
				})}
			</div>
		</section>
	);
}

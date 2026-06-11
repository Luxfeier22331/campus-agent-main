export function PlaceholderPage(input: { description: string; title: string }) {
	return (
		<section className="ops-panel p-6">
			<p className="ops-eyebrow">预留路由</p>
			<h2 className="ops-title">{input.title}</h2>
			<p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{input.description}</p>
			<p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">
				当前页面只保留后台信息架构与导航位置；对应编辑器、API
				和发布流程未接入前，不把这里展示成已完成能力。
			</p>
		</section>
	);
}

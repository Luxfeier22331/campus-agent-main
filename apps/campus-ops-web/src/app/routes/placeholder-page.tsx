export function PlaceholderPage(input: { description: string; title: string }) {
	return (
		<section className="ops-panel p-6">
			<p className="ops-eyebrow">Future Module</p>
			<h2 className="ops-title">{input.title}</h2>
			<p className="mt-2 text-sm text-zinc-600">{input.description}</p>
		</section>
	);
}

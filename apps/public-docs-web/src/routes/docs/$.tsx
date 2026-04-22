import { createFileRoute } from "@tanstack/react-router";
import { DocsPageScreen, loadDocsPage } from "./-page";

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: ({ params }) => loadDocsPage(params._splat?.split("/") ?? []),
});

function Page() {
	return <DocsPageScreen page={Route.useLoaderData()} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { DocsPageScreen, loadDocsPage } from "./-page";

export const Route = createFileRoute("/docs/")({
	component: Page,
	loader: () => loadDocsPage([]),
});

function Page() {
	return <DocsPageScreen page={Route.useLoaderData()} />;
}

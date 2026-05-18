import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "../vendor/vercel-ai-chatbot/app/globals.css";
import "./styles.css";
import { PublicChatAppFrame } from "@platform/chat/app-frame";

const PublicChatApp = lazy(async () => {
	const module = await import("./routes/app-router");

	return {
		default: module.AppRouter,
	};
});

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Public chat root element was not found.");
}

createRoot(rootElement).render(
	<StrictMode>
		<PublicChatAppFrame>
			<Suspense fallback={<PublicChatBootPlaceholder />}>
				<PublicChatApp />
			</Suspense>
		</PublicChatAppFrame>
	</StrictMode>,
);

function PublicChatBootPlaceholder() {
	return (
		<div className="chat-boot-placeholder" role="status">
			<div aria-hidden="true" className="chat-boot-placeholder__spinner" />
			<span>正在载入校园助理...</span>
		</div>
	);
}

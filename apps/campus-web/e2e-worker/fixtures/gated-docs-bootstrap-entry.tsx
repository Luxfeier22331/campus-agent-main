import React from "react";
import { createRoot } from "react-dom/client";
import GatedReaderBootstrap from "../../src/components/docs/gated-reader-bootstrap";

const rootElement = document.getElementById("gated-docs-bootstrap-root");

if (!rootElement) {
	throw new Error("gated docs bootstrap root is missing");
}

createRoot(rootElement).render(
	<React.StrictMode>
		<GatedReaderBootstrap />
	</React.StrictMode>,
);

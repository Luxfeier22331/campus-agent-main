import "./client-runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpsWebApp } from "./app/ops-web-app";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("ops-web root element is missing.");
}

createRoot(rootElement).render(
	<StrictMode>
		<OpsWebApp />
	</StrictMode>,
);

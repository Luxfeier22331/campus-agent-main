import { ToastProvider } from "@heroui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRouter } from "./app/router";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Campus root element was not found.");
}

createRoot(rootElement).render(
	<StrictMode>
		<AppRouter />
		<ToastProvider placement="top" />
	</StrictMode>,
);

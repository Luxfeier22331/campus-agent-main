"use client";

import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";

import { SessionProvider } from "next-auth/react";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";

function useDonorDocumentChrome() {
	useEffect(() => {
		const html = document.documentElement;
		const body = document.body;
		const previousLang = html.lang;
		const previousColorScheme = html.style.colorScheme;

		html.lang = "zh-CN";
		html.classList.remove("dark");
		html.style.colorScheme = "light";
		body.classList.add("antialiased");

		return () => {
			html.lang = previousLang;
			html.style.colorScheme = previousColorScheme;
			body.classList.remove("antialiased");
		};
	}, []);

	useEffect(() => {
		const existingMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		const meta = existingMeta ?? document.createElement("meta");
		const createdMeta = !existingMeta;
		const previousContent = meta.getAttribute("content");

		if (createdMeta) {
			meta.setAttribute("name", "theme-color");
			document.head.appendChild(meta);
		}

		meta.setAttribute("content", LIGHT_THEME_COLOR);

		return () => {
			if (createdMeta) {
				meta.remove();
				return;
			}

			if (previousContent === null) {
				meta.removeAttribute("content");
				return;
			}

			meta.setAttribute("content", previousContent);
		};
	}, []);
}

export function PublicChatAppFrame(props: { children: ReactNode }) {
	useDonorDocumentChrome();

	return (
		<SessionProvider basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}>
			<TooltipProvider>
				{props.children}
				<Toaster
					position="top-center"
					theme="light"
					toastOptions={{
						className: "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
					}}
				/>
			</TooltipProvider>
		</SessionProvider>
	);
}

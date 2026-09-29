import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function escapeHtml(value: unknown): string {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function normalizeText(value: unknown): string {
	return String(value ?? "").trim();
}

export function formatJson(value: unknown): string {
	return `${JSON.stringify(value, undefined, "\t")}\n`;
}

export function writeText(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

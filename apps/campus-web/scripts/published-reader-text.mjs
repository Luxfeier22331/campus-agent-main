import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(value) {
	return escapeHtml(value).replaceAll('"', "&quot;");
}

export function escapeMarkdownLinkText(value) {
	return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function normalizeText(value) {
	return String(value ?? "").trim();
}

export function formatJson(value) {
	return `${JSON.stringify(value, undefined, "\t")}\n`;
}

export function writeText(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

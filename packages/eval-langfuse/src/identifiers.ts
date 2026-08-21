import { createHash } from "node:crypto";

export function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function slug(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.toLowerCase();
}

export function stableId(prefix: string, ...parts: unknown[]): string {
	return `${slug(prefix)}:${sha256Text(parts.map(String).join(":")).slice(0, 24)}`;
}

import {
	NOTICE_CONTENT_ALIGNMENTS,
	NOTICE_CONTENT_ALLOWED_ATTRIBUTES,
	NOTICE_CONTENT_ALLOWED_TAGS,
	NOTICE_CONTENT_MAX_CELL_SPAN,
} from "campus-contracts/notices";

const ALLOWED_TAGS = new Set<string>(NOTICE_CONTENT_ALLOWED_TAGS);
const ALLOWED_ATTRIBUTES = NOTICE_CONTENT_ALLOWED_ATTRIBUTES as Readonly<
	Record<string, readonly string[]>
>;
const ALLOWED_ALIGNMENTS = new Set<string>(NOTICE_CONTENT_ALIGNMENTS);
const IMAGE_PLACEHOLDER = /^notice-asset:image:(0|[1-9][0-9]*)$/u;
const IMAGE_URL = /^\/api\/notices\/[1-9][0-9]*\/images\/(0|[1-9][0-9]*)$/u;
const OPS_IMAGE_URL = /^\/api\/ops\/notices\/[1-9][0-9]*\/images\/(0|[1-9][0-9]*)$/u;

export type PreparedNoticeContent =
	| { html: string; status: "ready" }
	| { status: "empty" | "invalid" };

export function prepareNoticeContentHtml(
	contentHtml: string | null,
	images: readonly { ordinal: number; url: string }[],
	options: { audience: "campus" | "ops" } = { audience: "campus" },
): PreparedNoticeContent {
	if (!contentHtml?.trim()) {
		return { status: "empty" };
	}
	const imageUrls = new Map<number, string>();
	for (const image of images) {
		if (
			imageUrls.has(image.ordinal) ||
			!(options.audience === "ops" ? OPS_IMAGE_URL : IMAGE_URL).test(image.url)
		) {
			return { status: "invalid" };
		}
		imageUrls.set(image.ordinal, image.url);
	}

	const document = new DOMParser().parseFromString(contentHtml, "text/html");
	if (
		document.querySelector("parsererror") ||
		document.head.childNodes.length > 0 ||
		!validateChildren(document.body, imageUrls)
	) {
		return { status: "invalid" };
	}
	return { html: document.body.innerHTML, status: "ready" };
}

function validateChildren(parent: Element, imageUrls: ReadonlyMap<number, string>): boolean {
	for (const node of parent.childNodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			continue;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		const element = node as Element;
		if (!(ALLOWED_TAGS.has(element.tagName) && validateAttributes(element, imageUrls))) {
			return false;
		}
		if (!validateChildren(element, imageUrls)) {
			return false;
		}
	}
	return true;
}

function validateAttributes(element: Element, imageUrls: ReadonlyMap<number, string>): boolean {
	const allowedAttributes = ALLOWED_ATTRIBUTES[element.tagName] ?? [];
	if (![...element.attributes].every((attribute) => allowedAttributes.includes(attribute.name))) {
		return false;
	}
	if (element.tagName === "A") {
		const href = element.getAttribute("href");
		if (
			element.attributes.length !== 2 ||
			!href ||
			element.getAttribute("rel") !== "noopener noreferrer" ||
			!isAllowedLink(href)
		) {
			return false;
		}
		return true;
	}
	if (element.tagName === "IMG") {
		if (
			element.attributes.length !== 2 ||
			!element.hasAttribute("alt") ||
			!element.hasAttribute("src")
		) {
			return false;
		}
		const match = IMAGE_PLACEHOLDER.exec(element.getAttribute("src") ?? "");
		if (!match) {
			return false;
		}
		const url = imageUrls.get(Number(match[1]));
		if (!url) {
			return false;
		}
		element.setAttribute("src", url);
		return true;
	}
	return [...element.attributes].every(validateSemanticAttribute);
}

function validateSemanticAttribute(attribute: Attr): boolean {
	if (attribute.name === "data-align") {
		return ALLOWED_ALIGNMENTS.has(attribute.value);
	}
	if (attribute.name === "data-indent") {
		return attribute.value === "true";
	}
	if (attribute.name === "data-emphasis") {
		return attribute.value === "alert";
	}
	if (attribute.name === "scope") {
		return attribute.value === "col";
	}
	if (attribute.name === "colspan" || attribute.name === "rowspan") {
		if (!/^[0-9]+$/u.test(attribute.value)) {
			return false;
		}
		const span = Number(attribute.value);
		return span >= 2 && span <= NOTICE_CONTENT_MAX_CELL_SPAN;
	}
	return false;
}

function isAllowedLink(value: string): boolean {
	try {
		return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

export function ocrMarkdownForBrowser(
	taskId: string,
	markdown: string,
	images: string[],
	base = `/api/ops/ocr/tasks/${taskId}`,
) {
	const allowed = new Set(images.map((key) => key.split("/").at(-1)));
	return markdown.replace(/images\/(\d+-\d+)/g, (path, name: string) =>
		allowed.has(name) ? `${base}/images/${name}` : path,
	);
}

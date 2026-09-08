export function ocrMarkdownForBrowser(taskId: string, markdown: string, images: string[]) {
	const allowed = new Set(images.map((key) => key.split("/").at(-1)));
	return markdown.replace(/images\/(\d+-\d+)/g, (path, name: string) =>
		allowed.has(name) ? `/api/ops/ocr/tasks/${taskId}/images/${name}` : path,
	);
}

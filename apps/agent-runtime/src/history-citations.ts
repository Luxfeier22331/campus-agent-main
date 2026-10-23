const historicalLinkOrMarker =
	/^(?:!?\[((?:[^[\]\n]|\[[^\]\n]*\])*)\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]\n]*\])|\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\])/;
const numericLabel = /^[0-9]+(?:[ \t]*,[ \t]*[0-9]+)*$/;

// Only the model-view copy of historical assistant prose is sanitized.
export function stripHistoricalCitations(content: string): string {
	let output = "";
	for (let pos = 0; pos < content.length; ) {
		let end = pos;
		if (content[pos] === "\\") {
			end = Math.min(pos + 2, content.length);
		} else {
			end = codeEnd(content, pos);
		}
		if (end > pos) {
			output += content.slice(pos, end);
			pos = end;
			continue;
		}
		const match =
			content[pos] === "[" || content[pos] === "!"
				? historicalLinkOrMarker.exec(content.slice(pos))
				: null;
		if (match) {
			if (!numericLabel.test(match[1] ?? match[2] ?? "")) {
				output += match[0];
			}
			pos += match[0].length;
		} else {
			output += content[pos];
			pos++;
		}
	}
	return output;
}

function codeEnd(text: string, start: number): number {
	const delimiter = text[start];
	if (delimiter !== "`" && delimiter !== "~") {
		return start;
	}
	let width = 1;
	while (text[start + width] === delimiter) {
		width++;
	}
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const fenced = width >= 3 && text.slice(lineStart, start).trim() === "";
	if (delimiter === "~" && !fenced) {
		return start;
	}
	for (let pos = start + width; pos < text.length; ) {
		if (text[pos] !== delimiter) {
			pos++;
			continue;
		}
		let count = 1;
		while (text[pos + count] === delimiter) {
			count++;
		}
		if (!fenced && count === width) {
			return pos + count;
		}
		if (
			fenced &&
			count >= width &&
			text.slice(text.lastIndexOf("\n", pos - 1) + 1, pos).trim() === ""
		) {
			return pos + count;
		}
		pos += count;
	}
	return fenced ? text.length : start;
}

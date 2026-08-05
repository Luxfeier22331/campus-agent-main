export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		target.isContentEditable ||
		Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
	);
}

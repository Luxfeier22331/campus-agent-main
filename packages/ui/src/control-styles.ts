export const controlClass =
	"w-full min-w-0 rounded-[var(--input-radius)] border border-input bg-control px-3 text-foreground transition-colors motion-reduce:transition-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger";

/**
 * 独立交互控件的键盘焦点环：外环、无偏移。
 * 容器内条目（菜单项、tab、分段控件）用 {@link focusRingInset}。
 */
export const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

/** 容器内条目的键盘焦点环：画在元素内部，不超出容器边界。 */
export const focusRingInset =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

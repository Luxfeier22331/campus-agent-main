import { Input, ThemeModeControl, ThemeProvider } from "@campus-agent/ui";
import { SearchIcon } from "lucide-react";
import {
	Component,
	type ErrorInfo,
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import "../app-styles.css";
import "./style-dev.css";
import {
	defaultStyleDevVariant,
	findStyleDevVariant,
	STYLE_DEV_GROUPS,
	STYLE_DEV_STORIES,
	type StyleDevStory,
} from "./catalog";
import { buildStyleDevHash, parseStyleDevHash, type StyleDevLocation } from "./navigation";

export type { StyleDevLocation } from "./navigation";
export { buildStyleDevHash, parseStyleDevHash } from "./navigation";

function initialVariantMap(): Record<string, string> {
	return Object.fromEntries(
		STYLE_DEV_STORIES.map((story) => [story.id, defaultStyleDevVariant(story).id]),
	);
}

class PreviewErrorBoundary extends Component<
	{ children: ReactNode; storyId: string },
	{ error: Error | null }
> {
	override state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error): { error: Error } {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(
			`Campus style-dev story failed: ${this.props.storyId}`,
			error,
			info.componentStack,
		);
	}

	override render() {
		if (this.state.error) {
			return (
				<pre className="style-dev-preview-error" role="alert">
					{this.state.error.stack ?? this.state.error.message}
				</pre>
			);
		}
		return this.props.children;
	}
}

function StoryOverview({
	headingRef,
	onOpenStory,
	stories,
}: {
	headingRef: RefObject<HTMLHeadingElement | null>;
	onOpenStory: (storyId: string) => void;
	stories: readonly StyleDevStory[];
}) {
	return (
		<section aria-labelledby="style-dev-overview-title" className="style-dev-overview">
			<h1 id="style-dev-overview-title" ref={headingRef} tabIndex={-1}>
				组件
			</h1>
			{STYLE_DEV_GROUPS.map((group) => {
				const groupStories = stories.filter((story) => story.group === group);
				if (groupStories.length === 0) {
					return null;
				}
				return (
					<section
						aria-labelledby={`style-dev-group-${group}`}
						className="style-dev-group"
						key={group}
					>
						<h2 id={`style-dev-group-${group}`}>{group}</h2>
						<ul className="style-dev-story-list">
							{groupStories.map((story) => (
								<li key={story.id}>
									<a
										className="style-dev-story-link"
										href={buildStyleDevHash(story.id, defaultStyleDevVariant(story).id)}
										onClick={(event) => {
											event.preventDefault();
											onOpenStory(story.id);
										}}
									>
										<span>{story.title}</span>
										<span aria-hidden="true">›</span>
									</a>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</section>
	);
}

function VariantSelector({
	onChange,
	story,
	selectedVariant,
}: {
	onChange: (variantId: string) => void;
	story: StyleDevStory;
	selectedVariant: string;
}) {
	if (story.variants.length <= 1) {
		return null;
	}
	return (
		<fieldset aria-label={`${story.title}变体`} className="style-dev-variant-tabs">
			<legend className="sr-only">{story.title}变体</legend>
			{story.variants.map((variant) => (
				<button
					aria-pressed={selectedVariant === variant.id}
					className="style-dev-variant-tab"
					key={variant.id}
					onClick={() => onChange(variant.id)}
					type="button"
				>
					{variant.label}
				</button>
			))}
		</fieldset>
	);
}

function StoryDetail({
	onBack,
	onVariantChange,
	selectedVariant,
	story,
}: {
	onBack: () => void;
	onVariantChange: (variantId: string) => void;
	selectedVariant: string;
	story: StyleDevStory;
}) {
	const headingRef = useRef<HTMLHeadingElement>(null);
	const variant = findStyleDevVariant(story, selectedVariant);

	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);

	return (
		<article
			className="style-dev-detail"
			data-style-dev-story={story.id}
			id={story.id}
			key={story.id}
		>
			<div className="style-dev-detail-toolbar">
				<button className="style-dev-back" onClick={onBack} type="button">
					返回组件目录
				</button>
				<span>{story.group}</span>
			</div>
			<h1 className="style-dev-story-title" ref={headingRef} tabIndex={-1}>
				{story.title}
			</h1>
			<VariantSelector onChange={onVariantChange} selectedVariant={variant.id} story={story} />
			<div className="style-dev-preview" data-style-dev-preview key={`${story.id}:${variant.id}`}>
				<PreviewErrorBoundary storyId={`${story.id}/${variant.id}`}>
					{variant.render()}
				</PreviewErrorBoundary>
			</div>
		</article>
	);
}

function StyleDevApp() {
	const [location, setLocation] = useState<StyleDevLocation>(() =>
		parseStyleDevHash(window.location.hash),
	);
	const [query, setQuery] = useState("");
	const [variantMap, setVariantMap] = useState<Record<string, string>>(initialVariantMap);
	const overviewHeadingRef = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		const handleHashChange = () => setLocation(parseStyleDevHash(window.location.hash));
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
	const filteredStories = useMemo(() => {
		if (!normalizedQuery) {
			return STYLE_DEV_STORIES;
		}
		return STYLE_DEV_STORIES.filter((story) => {
			const variantText = story.variants
				.flatMap((variant) => [variant.id, variant.label])
				.join(" ");
			return `${story.title} ${story.group} ${variantText}`
				.toLocaleLowerCase("zh-CN")
				.includes(normalizedQuery);
		});
	}, [normalizedQuery]);

	const selectedStory = location.storyId
		? (STYLE_DEV_STORIES.find((story) => story.id === location.storyId) ?? null)
		: null;
	const selectedVariant = selectedStory
		? findStyleDevVariant(selectedStory, location.variantId ?? variantMap[selectedStory.id] ?? null)
				.id
		: "";

	useEffect(() => {
		if (location.storyId && !selectedStory) {
			const next = { storyId: null, variantId: null } satisfies StyleDevLocation;
			window.history.replaceState(null, "", buildStyleDevHash(null));
			setLocation(next);
			return;
		}
		if (selectedStory && location.variantId !== selectedVariant) {
			const next = {
				storyId: selectedStory.id,
				variantId: selectedVariant,
			} satisfies StyleDevLocation;
			window.history.replaceState(null, "", buildStyleDevHash(next.storyId, next.variantId));
			setLocation(next);
		}
	}, [location.storyId, location.variantId, selectedStory, selectedVariant]);

	function writeLocation(next: StyleDevLocation, focus?: "overview" | "detail") {
		const hash = buildStyleDevHash(next.storyId, next.variantId);
		if (window.location.hash !== hash) {
			window.history.replaceState(null, "", hash);
		}
		setLocation(next);
		if (focus === "overview") {
			window.scrollTo({ top: 0, left: 0, behavior: "auto" });
			window.requestAnimationFrame(() =>
				overviewHeadingRef.current?.focus({ preventScroll: true }),
			);
		}
		if (focus === "detail") {
			window.scrollTo({ top: 0, left: 0, behavior: "auto" });
		}
	}

	function openStory(storyId: string, variantId?: string) {
		const story = STYLE_DEV_STORIES.find((candidate) => candidate.id === storyId);
		if (!story) {
			return;
		}
		const variant = findStyleDevVariant(story, variantId ?? variantMap[storyId] ?? null);
		setVariantMap((current) => ({ ...current, [storyId]: variant.id }));
		writeLocation({ storyId, variantId: variant.id }, "detail");
	}

	function openOverview() {
		writeLocation({ storyId: null, variantId: null }, "overview");
	}

	function setStoryVariant(storyId: string, variantId: string) {
		setVariantMap((current) => ({ ...current, [storyId]: variantId }));
		writeLocation({ storyId, variantId });
	}

	return (
		<div className="style-dev-root" data-ui-profile="campus">
			<title>Campus UI</title>
			<a className="style-dev-skip-link" href="#style-dev-main">
				跳到主要内容
			</a>
			<div className="style-dev-shell">
				<aside aria-label="组件目录" className="style-dev-sidebar">
					<button className="style-dev-brand" onClick={openOverview} type="button">
						<span aria-hidden className="style-dev-brand-mark">
							UI
						</span>
						<span>Campus UI</span>
					</button>
					<nav aria-label="组件分类">
						{STYLE_DEV_GROUPS.map((group) => {
							const groupStories = filteredStories.filter((story) => story.group === group);
							if (groupStories.length === 0) {
								return null;
							}
							return (
								<section className="style-dev-sidebar-group" key={group}>
									<h2 className="style-dev-sidebar-title">{group}</h2>
									{groupStories.map((story) => (
										<a
											aria-current={story.id === selectedStory?.id ? "page" : undefined}
											className={
												story.id === selectedStory?.id
													? "style-dev-sidebar-link is-active"
													: "style-dev-sidebar-link"
											}
											href={buildStyleDevHash(
												story.id,
												variantMap[story.id] ?? defaultStyleDevVariant(story).id,
											)}
											key={story.id}
											onClick={(event) => {
												event.preventDefault();
												openStory(story.id);
											}}
										>
											{story.title}
										</a>
									))}
								</section>
							);
						})}
					</nav>
				</aside>

				<div className="style-dev-content">
					<header className="style-dev-header">
						<div className="style-dev-header-actions">
							<div className="style-dev-search">
								<SearchIcon aria-hidden />
								<Input
									aria-label="搜索组件或变体"
									className="style-dev-search-input ps-10"
									id="style-dev-search"
									name="style-dev-search"
									onChange={(event) => setQuery(event.target.value)}
									placeholder="搜索组件或变体"
									value={query}
								/>
							</div>
							<ThemeModeControl aria-label="主题" label="主题" />
						</div>
					</header>

					<div className="style-dev-mobile-nav">
						<label className="sr-only" htmlFor="style-dev-mobile-story">
							选择组件
						</label>
						<select
							id="style-dev-mobile-story"
							value={selectedStory?.id ?? "overview"}
							onChange={(event) =>
								event.target.value === "overview" ? openOverview() : openStory(event.target.value)
							}
						>
							<option value="overview">组件</option>
							{filteredStories.map((story) => (
								<option key={story.id} value={story.id}>
									{story.group} / {story.title}
								</option>
							))}
						</select>
					</div>

					<main id="style-dev-main" tabIndex={-1}>
						{selectedStory ? (
							<StoryDetail
								onBack={openOverview}
								onVariantChange={(variantId) => setStoryVariant(selectedStory.id, variantId)}
								selectedVariant={selectedVariant}
								story={selectedStory}
							/>
						) : filteredStories.length > 0 ? (
							<StoryOverview
								headingRef={overviewHeadingRef}
								onOpenStory={openStory}
								stories={filteredStories}
							/>
						) : (
							<section aria-live="polite" className="style-dev-empty-results">
								没有匹配的组件
							</section>
						)}
					</main>
				</div>
			</div>
		</div>
	);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Style dev root element was not found.");
}

const hot = import.meta.hot;
const hotData = hot?.data as { root?: ReturnType<typeof createRoot> } | undefined;
const root = hotData?.root ?? createRoot(rootElement);
root.render(
	<ThemeProvider storageKey="campus-agent.style-dev.theme">
		<StyleDevApp />
	</ThemeProvider>,
);

if (hot) {
	hot.data.root = root;
	hot.dispose(() => {
		root.unmount();
		hot.data.root = undefined;
	});
}

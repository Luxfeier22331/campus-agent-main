import { Badge, Button, Dialog, DialogContent, DialogTitle, focusRing } from "@campus-agent/ui";
import { MapPin, X } from "lucide-react";
import { motion } from "motion/react";
import { popoverPresence, sheetPresence } from "@/components/ui/motion";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { MapPlaceView } from "@/features/map/view-model";

export function MapPlacePopover({
	isDesktop,
	onClose,
	place,
}: {
	isDesktop: boolean;
	onClose: () => void;
	place: MapPlaceView;
}) {
	function DetailCard({ titleKind = "heading" }: { titleKind?: "dialog" | "heading" }) {
		const title =
			titleKind === "dialog" ? (
				<DialogTitle className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
					{place.place.title}
				</DialogTitle>
			) : (
				<h2 className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
					{place.place.title}
				</h2>
			);
		return (
			<div className="flex items-start gap-3 p-4">
				<span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-selected text-selected-foreground">
					<MapPin aria-hidden="true" className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					{title}
					<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
						{place.place.campus} · {place.categoryLabel}
					</p>
					<p className="mt-3 text-sm leading-6 text-[var(--sys-text-muted)]">
						{place.place.description}
					</p>
					<div className="mt-3 space-y-2">
						{place.detailRows.map((row) => (
							<div className="grid grid-cols-[64px_1fr] gap-3 text-sm" key={row.label}>
								<span className="text-[var(--sys-text-subtle)]">{row.label}</span>
								<span className="text-[var(--sys-text-muted)]">{row.value}</span>
							</div>
						))}
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						{place.displayTags.map((tag) => (
							<Badge className="bg-surface-muted text-muted-foreground" key={tag} tone="neutral">
								{tag}
							</Badge>
						))}
					</div>
				</div>
			</div>
		);
	}

	if (isDesktop) {
		return (
			<Popover open>
				<PopoverAnchor asChild>
					<div className="pointer-events-none absolute left-[384px] top-20 z-[var(--layer-domain)] size-1" />
				</PopoverAnchor>
				<PopoverContent
					aria-label={place.place.title}
					align="start"
					className="pointer-events-auto z-[var(--layer-domain)] w-[340px] border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface-strong)] p-0 shadow-[var(--shadow-sm)] backdrop-blur-md"
					data-variant="popover"
					onEscapeKeyDown={onClose}
					onPointerDownOutside={(event) => event.preventDefault()}
					side="right"
					sideOffset={20}
				>
					<motion.div key={place.place.id} {...popoverPresence}>
						<Button
							aria-label="关闭地点详情"
							className="absolute right-3 top-3 z-10"
							onClick={onClose}
							size="icon-lg"
							variant="ghost"
						>
							<X aria-hidden="true" className="size-4" />
						</Button>
						<DetailCard />
					</motion.div>
				</PopoverContent>
			</Popover>
		);
	}
	return (
		<Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
			<DialogContent
				aria-label={place.place.title}
				className="pointer-events-auto inset-x-3 bottom-3 top-auto left-auto max-h-[48dvh] w-auto translate-x-0 translate-y-0 overflow-y-auto rounded-2xl border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface-strong)] p-0 pb-[max(0px,env(safe-area-inset-bottom))] shadow-[var(--shadow-sm)] backdrop-blur-md"
				data-variant="sheet"
				showCloseButton={false}
			>
				<motion.div key={place.place.id} {...sheetPresence}>
					<Button
						aria-label="关闭地点详情"
						className={`mx-auto mt-2 grid min-h-5 w-16 place-items-center rounded-full text-[var(--sys-text-subtle)] outline-none ${focusRing}`}
						onClick={onClose}
						variant="ghost"
					>
						<span className="h-1 w-10 rounded-full bg-[var(--sys-border-default)]" />
					</Button>
					<div className="relative">
						<DetailCard titleKind="dialog" />
						<Button
							aria-label="关闭地点详情"
							className="absolute right-3 top-3"
							onClick={onClose}
							size="icon-lg"
							variant="ghost"
						>
							<X aria-hidden="true" className="size-4" />
						</Button>
					</div>
				</motion.div>
			</DialogContent>
		</Dialog>
	);
}

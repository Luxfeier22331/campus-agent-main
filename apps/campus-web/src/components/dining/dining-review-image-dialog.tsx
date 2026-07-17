import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function DiningReviewImageDialog({
	alt,
	onOpenChange,
	open,
	src,
}: {
	alt: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	src: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-3xl p-3">
				<DialogTitle className="sr-only">{alt}</DialogTitle>
				<img alt={alt} className="max-h-[80vh] w-full rounded-lg object-contain" src={src} />
			</DialogContent>
		</Dialog>
	);
}

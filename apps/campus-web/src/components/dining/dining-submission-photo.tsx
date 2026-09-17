import { Button } from "@campus-agent/ui";
import { type ReactNode, useState } from "react";

export function DiningSubmissionPhoto({
	photo,
	name,
	compact = false,
	renderLink,
}: {
	photo: { url: string; width: number; height: number };
	name: string;
	compact?: boolean;
	renderLink?: (image: ReactNode) => ReactNode;
}) {
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const image = (
		<img
			key={attempt}
			alt={`${name}的投稿照片`}
			className={
				compact
					? "size-16 shrink-0 rounded-md object-cover"
					: "max-h-80 w-full rounded-md object-contain"
			}
			height={photo.height}
			width={photo.width}
			loading="lazy"
			onError={() => setFailed(true)}
			src={photo.url}
		/>
	);
	return failed ? (
		<>
			{renderLink?.(null)}
			<div className="py-3 text-sm text-muted-foreground">
				<p>照片暂时无法显示。</p>
				<Button
					className="mt-2 min-h-11"
					size="sm"
					variant="outline"
					onClick={() => {
						setFailed(false);
						setAttempt(attempt + 1);
					}}
				>
					重试照片
				</Button>
			</div>
		</>
	) : renderLink ? (
		renderLink(image)
	) : (
		image
	);
}

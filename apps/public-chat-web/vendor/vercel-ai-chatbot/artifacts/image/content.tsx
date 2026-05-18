import { ImageEditor } from "@/components/chat/image-editor";
import type { ImageArtifactContentProps } from "./client";

export function ImageArtifactContent(props: ImageArtifactContentProps) {
	return <ImageEditor {...props} />;
}

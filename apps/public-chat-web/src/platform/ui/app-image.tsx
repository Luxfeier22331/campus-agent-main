import type { ImgHTMLAttributes } from "react";

type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
	src: string;
};

export function AppImage({ alt, ...props }: AppImageProps) {
	return <img alt={alt ?? ""} decoding="async" loading="lazy" {...props} />;
}

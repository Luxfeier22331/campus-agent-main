import type { ImgHTMLAttributes } from "react";

import { AppImage } from "@platform/ui/app-image";

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  alt: string;
  fill?: boolean;
  priority?: boolean;
  src: string;
  unoptimized?: boolean;
};

export default function Image(props: ImageProps) {
  const { fill: _fill, priority: _priority, unoptimized: _unoptimized, ...imageProps } = props;

  return <AppImage {...imageProps} />;
}

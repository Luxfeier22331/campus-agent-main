import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  Plus,
  Sparkles,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

type IconProps = LucideProps;

function iconProps(props: IconProps): IconProps {
  return {
    "aria-hidden": true,
    focusable: false,
    size: 18,
    strokeWidth: 1.75,
    ...props,
  };
}

export function MenuIcon(props: IconProps) {
  return <Menu {...iconProps(props)} />;
}

export function PlusIcon(props: IconProps) {
  return <Plus {...iconProps(props)} />;
}

export function MessageSquareIcon(props: IconProps) {
  return <MessageSquare {...iconProps(props)} />;
}

export function MoreHorizontalIcon(props: IconProps) {
  return <MoreHorizontal {...iconProps(props)} />;
}

export function PenSquareIcon(props: IconProps) {
  return <PenSquare {...iconProps(props)} />;
}

export function TrashIcon(props: IconProps) {
  return <Trash2 {...iconProps(props)} />;
}

export function CloseIcon(props: IconProps) {
  return <X {...iconProps(props)} />;
}

export function PanelLeftIcon(props: IconProps & { direction?: "collapse" | "expand" }) {
  const { direction = "collapse", ...rest } = props;

  if (direction === "expand") {
    return <PanelLeftOpen {...iconProps(rest)} />;
  }

  return <PanelLeftClose {...iconProps(rest)} />;
}

export function ChevronIcon(props: IconProps & { direction?: "up" | "down" }) {
  const { direction = "down", ...rest } = props;

  if (direction === "up") {
    return <ChevronUp {...iconProps(rest)} />;
  }

  return <ChevronDown {...iconProps(rest)} />;
}

export function SendIcon(props: IconProps) {
  return <SendHorizontal {...iconProps(props)} />;
}

export function SparklesIcon(props: IconProps) {
  return <Sparkles {...iconProps(props)} />;
}

export function ArrowUpIcon(props: IconProps) {
  return <ArrowUp {...iconProps(props)} />;
}

export function ArrowDownIcon(props: IconProps) {
  return <ArrowDown {...iconProps(props)} />;
}

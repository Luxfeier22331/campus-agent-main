from __future__ import annotations

import re
import sys
import textwrap
from pathlib import Path

LINE_WIDTH = 80
LIST_ITEM_RE = re.compile(r"^(?P<indent> {0,3})(?P<marker>(?:[-*+])|(?:\d+\.))\s*(?P<content>.*)$")
DECIMAL_LABEL_RE = re.compile(
    r"^(?P<indent> {0,3})(?P<label>\d+\.\d+(?:\.\d+)*)(?P<rest>(?:\s+.*)?)$"
)
TABLE_RE = re.compile(r"^\s*\|")
HEADING_RE = re.compile(r"^\s{0,3}#")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HTML_RE = re.compile(r"^\s*</?[A-Za-z][^>]*>\s*$")
IMPORT_RE = re.compile(r"^\s*(import|export)\s+")
BLOCKQUOTE_RE = re.compile(r"^\s*>")
REFERENCE_DEF_RE = re.compile(r"^\s*\[[^\]]+\]:")
RULE_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
URL_RE = re.compile(r"(?<![<(])https?://[^\s)>]+")
SHELL_TOKEN_RE = re.compile(r"""(?:'[^']*'|"[^"]*"|\S+)""")
SHELL_INFO_NAMES = {"bash", "sh", "shell", "zsh"}
NON_SHELL_INFO_NAMES = {
    "json",
    "python",
    "py",
    "ts",
    "tsx",
    "js",
    "jsx",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "mdx",
    "diff",
}
SHELL_PREFIXES = (
    "uv ",
    "pnpm ",
    "docker ",
    "env ",
    "curl ",
    "powershell.exe ",
    "until ",
    "APP_",
    "STAGING_",
    "export ",
)


def _wrap_text(text: str, *, initial_prefix: str = "", subsequent_prefix: str = "") -> list[str]:
    stripped = text.strip()
    if not stripped:
        return [""]
    wrapper = textwrap.TextWrapper(
        width=LINE_WIDTH,
        initial_indent=initial_prefix,
        subsequent_indent=subsequent_prefix,
        break_long_words=True,
        break_on_hyphens=False,
        replace_whitespace=False,
        drop_whitespace=True,
    )
    return wrapper.fill(stripped).splitlines()


def _normalize_inline_text(lines: list[str]) -> str:
    joined = " ".join(part.strip() for part in lines if part.strip())
    joined = re.sub(r"\s+", " ", joined).strip()
    return URL_RE.sub(lambda match: f"<{match.group(0)}>", joined)


def _is_special(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    return bool(
        TABLE_RE.match(line)
        or HEADING_RE.match(line)
        or FENCE_RE.match(line)
        or HTML_RE.match(line)
        or IMPORT_RE.match(line)
        or BLOCKQUOTE_RE.match(line)
        or REFERENCE_DEF_RE.match(line)
        or RULE_RE.match(line)
    )


def _split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def _is_table_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def _render_table(table_lines: list[str]) -> list[str]:
    rows = [_split_table_row(line) for line in table_lines]
    if len(rows) >= 2 and _is_table_separator(rows[1]):
        header = rows[0]
        body = rows[2:]
        if any(len(line) > LINE_WIDTH for line in table_lines):
            rendered: list[str] = []
            for row in body:
                values = row + [""] * (len(header) - len(row))
                record_lines: list[str] = []
                first = True
                for name, value in zip(header, values, strict=False):
                    if not value:
                        continue
                    prefix = "- " if first else "  "
                    continuation = "  "
                    record_lines.extend(
                        _wrap_text(
                            f"{name}: {value}",
                            initial_prefix=prefix,
                            subsequent_prefix=continuation,
                        )
                    )
                    first = False
                if record_lines:
                    if rendered:
                        rendered.append("")
                    rendered.extend(record_lines)
            return rendered
        width = max(len(row) for row in rows)
        normalized_rows = [row + [""] * (width - len(row)) for row in rows]
        rendered = ["| " + " | ".join(normalized_rows[0]) + " |"]
        rendered.append("| " + " | ".join(["---"] * width) + " |")
        for row in normalized_rows[2:]:
            rendered.append("| " + " | ".join(row) + " |")
        return rendered
    return [line.rstrip() for line in table_lines]


def _looks_like_shell_block(fence_open: str, body: list[str]) -> bool:
    info = fence_open.strip()[3:].strip().lower()
    if info in SHELL_INFO_NAMES:
        return True
    if info in NON_SHELL_INFO_NAMES:
        return False
    candidates = [
        line.strip() for line in body if line.strip() and not line.strip().startswith("#")
    ]
    if not candidates:
        return False
    shellish = 0
    for line in candidates:
        if line.startswith(SHELL_PREFIXES) or " --" in line or line.endswith(" \\"):
            shellish += 1
    return shellish >= max(1, len(candidates) // 2)


def _wrap_shell_line(line: str) -> list[str]:
    stripped = line.rstrip()
    if len(stripped) <= LINE_WIDTH:
        return [stripped]
    indent = line[: len(line) - len(line.lstrip(" "))]
    body = stripped.strip()
    if not body or body.startswith("#"):
        return [stripped]
    tokens = SHELL_TOKEN_RE.findall(body.removesuffix("\\").rstrip())
    if len(tokens) < 2:
        return [stripped]

    continuation = indent + "  "
    wrapped: list[str] = []
    current = indent + tokens[0]
    for token in tokens[1:]:
        candidate = f"{current} {token}"
        suffix = " \\" if len(wrapped) or len(tokens) > 1 else ""
        if len(candidate + suffix) <= LINE_WIDTH:
            current = candidate
            continue
        wrapped.append(f"{current} \\")
        current = continuation + token
    wrapped.append(current)
    return [segment.rstrip() for segment in wrapped]


def _render_fenced_block(fence_open: str, body: list[str], fence_close: str) -> list[str]:
    if not _looks_like_shell_block(fence_open, body):
        return [fence_open, *body, fence_close]
    rendered = [fence_open]
    for line in body:
        if line.strip():
            rendered.extend(_wrap_shell_line(line))
        else:
            rendered.append("")
    rendered.append(fence_close)
    return rendered


def _flush_paragraph(buffer: list[str], output: list[str]) -> None:
    if not buffer:
        return
    normalized = _normalize_inline_text(buffer)
    decimal_match = DECIMAL_LABEL_RE.match(normalized)
    if decimal_match:
        label = decimal_match.group("label").replace(".", r"\.", 1)
        output.extend(
            _wrap_text(f"{decimal_match.group('indent')}{label}{decimal_match.group('rest')}")
        )
    else:
        output.extend(_wrap_text(normalized))
    buffer.clear()


def _flush_list(buffer: list[str], output: list[str]) -> None:
    if not buffer:
        return
    match = LIST_ITEM_RE.match(buffer[0].rstrip())
    if not match:
        _flush_paragraph(buffer, output)
        return
    marker = match.group("marker")
    content_lines = [match.group("content"), *buffer[1:]]
    content = _normalize_inline_text(content_lines)
    if marker.endswith("."):
        prefix = f"{match.group('indent')}1. "
    else:
        prefix = f"{match.group('indent')}{marker} "
    output.extend(
        _wrap_text(
            content,
            initial_prefix=prefix,
            subsequent_prefix=" " * len(prefix),
        )
    )
    buffer.clear()


def _rewrite_markdown(text: str) -> str:
    lines = text.splitlines()
    output: list[str] = []
    paragraph_buffer: list[str] = []
    list_buffer: list[str] = []
    in_fence = False
    in_frontmatter = False
    frontmatter_closed = False

    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if index == 0 and stripped == "---":
            in_frontmatter = True
            output.append(line.rstrip())
            index += 1
            continue

        if in_frontmatter:
            output.append(line.rstrip())
            if stripped == "---":
                in_frontmatter = False
                frontmatter_closed = True
            index += 1
            continue

        if FENCE_RE.match(line):
            _flush_list(list_buffer, output)
            _flush_paragraph(paragraph_buffer, output)
            fence_open = line.rstrip()
            if in_fence:
                output.append(fence_open)
                in_fence = False
                index += 1
                continue
            index += 1
            fence_body: list[str] = []
            while index < len(lines) and not FENCE_RE.match(lines[index]):
                fence_body.append(lines[index].rstrip())
                index += 1
            if index < len(lines):
                fence_close = lines[index].rstrip()
                output.extend(_render_fenced_block(fence_open, fence_body, fence_close))
                index += 1
            else:
                output.append(fence_open)
                output.extend(fence_body)
            continue

        if in_fence:
            output.append(line.rstrip())
            index += 1
            continue

        if TABLE_RE.match(line):
            _flush_list(list_buffer, output)
            _flush_paragraph(paragraph_buffer, output)
            table_lines = [line.rstrip()]
            index += 1
            while index < len(lines) and TABLE_RE.match(lines[index]):
                table_lines.append(lines[index].rstrip())
                index += 1
            output.extend(_render_table(table_lines))
            continue

        list_match = LIST_ITEM_RE.match(line.rstrip())
        if list_match and not DECIMAL_LABEL_RE.match(line.rstrip()):
            _flush_paragraph(paragraph_buffer, output)
            if list_buffer:
                _flush_list(list_buffer, output)
                output.append("")
            list_buffer = [line.rstrip()]
            index += 1
            while index < len(lines):
                next_line = lines[index]
                next_stripped = next_line.strip()
                if not next_stripped:
                    break
                if _is_special(next_line) and not LIST_ITEM_RE.match(next_line.rstrip()):
                    break
                if LIST_ITEM_RE.match(next_line.rstrip()) and not DECIMAL_LABEL_RE.match(
                    next_line.rstrip()
                ):
                    break
                list_buffer.append(next_line.rstrip())
                index += 1
            _flush_list(list_buffer, output)
            if index < len(lines) and not lines[index].strip():
                output.append("")
                while index < len(lines) and not lines[index].strip():
                    index += 1
            continue

        if not stripped:
            _flush_list(list_buffer, output)
            _flush_paragraph(paragraph_buffer, output)
            if output and output[-1] != "":
                output.append("")
            index += 1
            continue

        if _is_special(line):
            _flush_list(list_buffer, output)
            _flush_paragraph(paragraph_buffer, output)
            output.append(line.rstrip())
            index += 1
            continue

        paragraph_buffer.append(line.rstrip())
        index += 1

    _flush_list(list_buffer, output)
    _flush_paragraph(paragraph_buffer, output)

    while output and output[-1] == "":
        output.pop()

    normalized = "\n".join(output) + "\n"
    if frontmatter_closed:
        normalized = normalized.replace("---\n\n", "---\n", 1)
    return normalized


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: reflow_markdown.py <path> [<path> ...]", file=sys.stderr)
        return 2
    for raw_path in argv[1:]:
        path = Path(raw_path)
        original = path.read_text(encoding="utf-8")
        rewritten = _rewrite_markdown(original)
        if rewritten != original:
            path.write_text(rewritten, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urlsplit

from .errors import KnowledgeError


INLINE_LINK_PATTERN = re.compile(r"(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)")
INLINE_IMAGE_PATTERN = re.compile(r"!\[[^\]\n]*\]\([^)\n]+\)")
REFERENCE_LINK_PATTERN = re.compile(
    r"(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]"
)
REFERENCE_IMAGE_PATTERN = re.compile(
    r"!\[([^\]\n]+)\]\[([^\]\n]*)\]"
)
SHORTCUT_LINK_PATTERN = re.compile(r"(?<!!)\[([^\]\n]+)\](?![\[(])")
SHORTCUT_IMAGE_PATTERN = re.compile(r"!\[([^\]\n]+)\](?![\[(])")
REFERENCE_DEFINITION_PATTERN = re.compile(
    r"^[ ]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))"
    r"(?:[ \t]+.*)?$",
    re.MULTILINE,
)
AUTOLINK_PATTERN = re.compile(
    r"<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|"
    r"[^<>\s@]+@[^<>\s@]+)>"
)
FENCE_OPEN_PATTERN = re.compile(r"^[ ]{0,3}(`{3,}|~{3,})(.*)$")


def without_fenced_code(text: str) -> str:
    output = []
    fence_character = None
    fence_length = 0
    for line in text.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        ending = line[len(content):]
        if fence_character is None:
            opening = FENCE_OPEN_PATTERN.match(content)
            if opening is None:
                output.append(line)
                continue
            fence = opening.group(1)
            if fence[0] == "`" and "`" in opening.group(2):
                output.append(line)
                continue
            fence_character = fence[0]
            fence_length = len(fence)
        elif re.fullmatch(
            r"[ ]{0,3}"
            + re.escape(fence_character)
            + r"{" + str(fence_length) + r",}[ \t]*",
            content,
        ):
            fence_character = None
            fence_length = 0
        output.append(" " * len(content) + ending)
    return "".join(output)


def normalize_reference_label(value: str) -> str:
    return " ".join(value.split()).casefold()


def link_destination(value: str) -> str:
    value = value.strip()
    if value.startswith("<") and ">" in value:
        return value[1:value.index(">")]
    return value.split(maxsplit=1)[0]


def overlaps(span: Tuple[int, int], occupied: List[Tuple[int, int]]) -> bool:
    return any(span[0] < end and start < span[1] for start, end in occupied)


def image_spans(
    text: str,
    definitions: Dict[str, str],
) -> List[Tuple[int, int]]:
    spans = [match.span() for match in INLINE_IMAGE_PATTERN.finditer(text)]
    spans.extend(
        match.span() for match in REFERENCE_IMAGE_PATTERN.finditer(text)
    )
    spans.extend(
        match.span()
        for match in SHORTCUT_IMAGE_PATTERN.finditer(text)
        if normalize_reference_label(match.group(1)) in definitions
    )
    return spans


def reference_definitions(text: str) -> Dict[str, str]:
    definitions: Dict[str, str] = {}
    for match in REFERENCE_DEFINITION_PATTERN.finditer(text):
        label = normalize_reference_label(match.group(1))
        destination = match.group(2) or match.group(3)
        definitions.setdefault(label, destination)
    return definitions


def markdown_targets(
    body: str,
    definition_text: Optional[str] = None,
) -> Iterable[str]:
    text = without_fenced_code(body)
    definition_source = without_fenced_code(
        body if definition_text is None else definition_text
    )
    definitions = reference_definitions(definition_source)

    definition_spans = []
    for match in REFERENCE_DEFINITION_PATTERN.finditer(text):
        definition_spans.append(match.span())

    visible = list(text)
    for start, end in definition_spans:
        for index in range(start, end):
            if visible[index] not in "\r\n":
                visible[index] = " "
    text = "".join(visible)

    detected: List[Tuple[int, str]] = []
    occupied = image_spans(text, definitions)
    for match in INLINE_LINK_PATTERN.finditer(text):
        if overlaps(match.span(), occupied):
            continue
        destination = link_destination(match.group(1))
        if destination:
            detected.append((match.start(), destination))
        occupied.append(match.span())

    for match in REFERENCE_LINK_PATTERN.finditer(text):
        if overlaps(match.span(), occupied):
            continue
        label = match.group(2) or match.group(1)
        destination = definitions.get(normalize_reference_label(label))
        if destination is not None:
            detected.append((match.start(), destination))
        occupied.append(match.span())

    for match in AUTOLINK_PATTERN.finditer(text):
        if overlaps(match.span(), occupied):
            continue
        destination = match.group(1)
        if ":" not in destination:
            destination = "mailto:" + destination
        detected.append((match.start(), destination))
        occupied.append(match.span())

    for match in SHORTCUT_LINK_PATTERN.finditer(text):
        if overlaps(match.span(), occupied):
            continue
        destination = definitions.get(
            normalize_reference_label(match.group(1))
        )
        if destination is not None:
            detected.append((match.start(), destination))

    for _, destination in sorted(detected):
        yield destination


def markdown_path_destinations(body: str) -> Iterable[str]:
    text = without_fenced_code(body)
    definitions = reference_definitions(text)
    occupied = image_spans(text, definitions)
    declared: List[Tuple[int, str]] = []
    for match in REFERENCE_DEFINITION_PATTERN.finditer(text):
        declared.append((match.start(), match.group(2) or match.group(3)))
    for match in INLINE_LINK_PATTERN.finditer(text):
        if overlaps(match.span(), occupied):
            continue
        destination = link_destination(match.group(1))
        if destination:
            declared.append((match.start(), destination))
    for _, destination in sorted(declared):
        yield destination


def resolve_internal(root: Path, source: Path, target: str) -> Optional[Path]:
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.fragment:
        return None
    raw = unquote(parsed.path)
    if not raw:
        return None
    candidate = (
        root / raw.lstrip("/") if raw.startswith("/") else source.parent / raw
    )
    candidate = candidate.resolve()
    resolved_root = root.resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise KnowledgeError(
            f"{source}: link escapes tree root: {target}"
        ) from exc
    if candidate.is_dir():
        candidate = candidate / "index.md"
    return candidate


def resolve_document_path(root: Path, raw: Path) -> Path:
    candidate = raw if raw.is_absolute() else root / raw
    candidate = candidate.resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise KnowledgeError(
            f"{candidate}: document is outside the tree root"
        ) from exc
    return candidate / "index.md" if candidate.is_dir() else candidate

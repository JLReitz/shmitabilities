from typing import Iterable


def cell(value: object) -> str:
    return (
        str(value)
        .replace("`", "")
        .replace("\t", " ")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def row(values: Iterable[object]) -> str:
    return "\t".join(cell(value) for value in values)

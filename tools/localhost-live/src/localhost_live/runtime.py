"""Runtime root and control-token helpers."""

from __future__ import annotations

import os
import re
import secrets
from pathlib import Path
from typing import Mapping

from localhost_live.jsonio import atomic_write_text


_TOKEN_HEX_PATTERN = re.compile(r"[0-9a-f]{64}")
_RUNTIME_SUBDIR = Path("shmitabilities-live") / "localhost-live"


def resolve_runtime_root(
    runtime_root: str | Path | None = None,
    *,
    env: Mapping[str, str] | None = None,
) -> Path:
    """Resolve runtime root with optional explicit override."""
    if runtime_root is not None:
        return Path(runtime_root)

    source_env = os.environ if env is None else env
    base_dir = source_env.get("XDG_RUNTIME_DIR") or source_env.get("TMPDIR") or "/tmp"
    return Path(base_dir) / _RUNTIME_SUBDIR


def generate_control_token(*, entropy_bytes: int = 32) -> str:
    """Generate a high-entropy control token as lowercase hex."""
    if entropy_bytes < 16:
        raise ValueError("entropy_bytes must be >= 16")
    return secrets.token_hex(entropy_bytes)


def control_token_path(runtime_root: str | Path) -> Path:
    """Return the control token path under the runtime root."""
    return Path(runtime_root) / "control.token"


def server_metadata_path(runtime_root: str | Path) -> Path:
    """Return the server metadata path under the runtime root."""
    return Path(runtime_root) / "server.json"


def ensure_control_token(runtime_root: str | Path) -> str:
    """
    Load or create the control token.

    Tokens are always stored in runtime-root control metadata, never in session content.
    """
    root = Path(runtime_root)
    root.mkdir(parents=True, exist_ok=True)
    token_file = control_token_path(root)
    if token_file.exists():
        token = token_file.read_text(encoding="utf-8").strip()
        if not _TOKEN_HEX_PATTERN.fullmatch(token):
            raise ValueError(f"Invalid control token format in {token_file}")
        return token

    token = generate_control_token()
    atomic_write_text(token_file, f"{token}\n")
    return token

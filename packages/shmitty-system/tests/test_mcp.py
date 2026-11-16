"""Black-box tests for the packaged knowledge MCP interface."""

import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

import pytest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = PACKAGE_ROOT / "bin" / "knowledge-cli"
MANIFEST = PACKAGE_ROOT / "mcp.json"
PROTOCOL_VERSION = "2025-11-25"
TOOL_NAMES = {
    "knowledge_read",
    "knowledge_search",
    "knowledge_connections",
    "knowledge_confidence",
    "knowledge_investment",
    "knowledge_verify",
    "knowledge_ontology",
}


class McpClient:
    """Exchange newline-delimited JSON-RPC messages with the packaged server."""

    def __init__(self, environment=None):
        process_environment = os.environ.copy()
        process_environment.update(environment or {})
        self.process = subprocess.Popen(
            [sys.executable, str(LAUNCHER), "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=process_environment,
        )

    def send(self, message):
        assert self.process.stdin is not None
        assert self.process.poll() is None

        self.process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def receive(self, timeout=3.0):
        assert self.process.stdout is not None

        ready, _, _ = select.select([self.process.stdout], [], [], timeout)
        assert ready, self._diagnostics()
        line = self.process.stdout.readline()
        assert line, self._diagnostics()

        return json.loads(line)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2.0)

    def _diagnostics(self):
        if self.process.poll() is None or self.process.stderr is None:
            return "MCP server did not return a protocol message"

        return self.process.stderr.read()


@pytest.fixture
def client():
    result = McpClient()
    try:
        initialize(result)

        yield result
    finally:
        result.close()


@pytest.fixture
def knowledge_root(tmp_path):
    root = tmp_path / "knowledge"
    source = root / "sources" / "example.com"
    source.mkdir(parents=True)
    (root / "index.md").write_text("---\n---\n# Test knowledge\n", encoding="utf-8")
    (source / "index.md").write_text(
        """---
type: Reference
title: Example source
description: Example source index.
tags: [sources, example.com, test]
resource: https://example.com/
resource_type: Website
timestamp: 2026-01-01T00:00:00Z
---
Example source abstract.

---

# Contents

- [Page](page.md)
""",
        encoding="utf-8",
    )
    (source / "page.md").write_text(
        """---
type: Reference
title: Example page
tags: [sources, example.com, test]
resource: https://example.com/page
resource_type: Webpage
timestamp: 2026-01-01T00:00:00Z
---
Complete report sentinel.
""",
        encoding="utf-8",
    )
    return root


def call_tool(client, request_id, name, arguments):
    client.send(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
    )

    return client.receive()


def initialize(client):
    client.send(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "1"},
            },
        }
    )
    response = client.receive()
    assert response["id"] == 1
    assert response["result"]["protocolVersion"] == PROTOCOL_VERSION
    client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})


def test_manifest_launches_installed_relative_path():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert manifest["$schema"] == (
        "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
    )
    server = manifest["mcpServers"]["shmitty-knowledge"]
    assert server == {
        "type": "stdio",
        "command": "python3",
        "args": ["bin/knowledge-cli", "mcp"],
    }
    package = json.loads((PACKAGE_ROOT / "package.json").read_text(encoding="utf-8"))
    assert "mcp.json" in package["files"]


def test_tool_catalog_matches_documented_contract(client):
    client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})

    response = client.receive()
    tools = {tool["name"]: tool for tool in response["result"]["tools"]}
    assert set(tools) == TOOL_NAMES
    assert tools["knowledge_read"]["inputSchema"]["required"] == ["documents"]
    assert tools["knowledge_ontology"]["inputSchema"]["properties"]["report"][
        "enum"
    ] == ["terms", "facts", "requirements"]
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools.values())
    assert all(not tool["annotations"]["destructiveHint"] for tool in tools.values())


def test_read_and_search_return_complete_existing_text(client, knowledge_root):
    search = call_tool(
        client,
        3,
        "knowledge_search",
        {"root": str(knowledge_root), "tags": ["test"], "type": "Reference"},
    )
    read = call_tool(
        client,
        4,
        "knowledge_read",
        {"root": str(knowledge_root), "documents": ["sources/example.com/page.md"]},
    )

    search_text = search["result"]["content"][0]["text"]
    read_text = read["result"]["content"][0]["text"]
    assert search["result"].get("isError") is not True
    assert "document\ttype\tsubtype\ttags\ttitle" in search_text
    assert "sources/example.com/page.md\tReference" in search_text
    assert read["result"].get("isError") is not True
    assert read_text.endswith("Complete report sentinel.\n")


def test_invalid_verification_is_normal_result(client, knowledge_root):
    response = call_tool(
        client,
        5,
        "knowledge_verify",
        {
            "root": str(knowledge_root),
            "document": "sources/example.com/page.md",
            "as_of": "2026-01-02T00:00:00Z",
        },
    )

    assert response["result"].get("isError") is not True
    assert "result\tinvalid" in response["result"]["content"][0]["text"]


def test_environment_root_fallback_and_explicit_precedence(knowledge_root, tmp_path):
    client = McpClient({"SHMIT_KNOWLEDGE_ROOT": str(knowledge_root)})
    try:
        initialize(client)

        fallback_result = call_tool(client, 6, "knowledge_search", {"tags": ["test"]})
    finally:
        client.close()

    client = McpClient({"SHMIT_KNOWLEDGE_ROOT": str(tmp_path / "missing")})
    try:
        initialize(client)

        explicit_result = call_tool(
            client,
            7,
            "knowledge_search",
            {"root": str(knowledge_root), "tags": ["test"]},
        )
    finally:
        client.close()

    assert fallback_result["result"].get("isError") is not True
    assert explicit_result["result"].get("isError") is not True


def test_malformed_calls_and_unknown_tools_are_protocol_errors(client):
    missing_input = call_tool(client, 8, "knowledge_read", {})
    unknown_tool = call_tool(client, 9, "knowledge_unknown", {})

    assert missing_input["error"]["code"] == -32602
    assert unknown_tool["error"]["code"] == -32601


def test_base_protocol_ping_and_invalid_request_id(client):
    client.send({"jsonrpc": "2.0", "id": 10, "method": "ping"})
    ping = client.receive()
    client.send({"jsonrpc": "2.0", "id": [], "method": "tools/list"})
    invalid = client.receive()

    assert ping == {"jsonrpc": "2.0", "id": 10, "result": {}}
    assert invalid["id"] is None
    assert invalid["error"]["code"] == -32600


@pytest.mark.parametrize("tool_name", sorted(TOOL_NAMES - {"knowledge_search"}))
def test_knowledge_errors_are_tool_errors(client, tmp_path, tool_name):
    arguments = {"root": str(tmp_path / "missing")}
    if tool_name == "knowledge_read":
        arguments["documents"] = ["missing.md"]
    elif tool_name == "knowledge_ontology":
        arguments["report"] = "terms"
    else:
        arguments["document"] = "missing.md"

    response = call_tool(client, 20, tool_name, arguments)

    assert response["result"]["isError"] is True
    assert response["result"]["content"][0]["text"]


def test_requests_run_concurrently_and_cancelled_result_is_omitted(
    client, knowledge_root, tmp_path
):
    blocked_root = tmp_path / "blocked-root"
    blocked_root.mkdir()
    blocked = blocked_root / "blocked.md"
    os.mkfifo(blocked)
    client.send(
        {
            "jsonrpc": "2.0",
            "id": 30,
            "method": "tools/call",
            "params": {
                "name": "knowledge_read",
                "arguments": {"root": str(blocked_root), "documents": ["blocked.md"]},
            },
        }
    )
    client.send(
        {
            "jsonrpc": "2.0",
            "id": 31,
            "method": "tools/call",
            "params": {
                "name": "knowledge_search",
                "arguments": {"root": str(knowledge_root), "tags": ["test"]},
            },
        }
    )

    concurrent = client.receive()
    assert concurrent["id"] == 31
    client.send(
        {
            "jsonrpc": "2.0",
            "method": "notifications/cancelled",
            "params": {"requestId": 30, "reason": "test cancellation"},
        }
    )
    deadline = time.monotonic() + 2.0
    while True:
        try:
            descriptor = os.open(blocked, os.O_WRONLY | os.O_NONBLOCK)
            break
        except OSError:
            assert time.monotonic() < deadline
            time.sleep(0.01)
    with os.fdopen(descriptor, "w", encoding="utf-8") as fifo:
        fifo.write("---\ntype: Concept\ntitle: Blocked\ntags: [test]\n---\n")
    client.send({"jsonrpc": "2.0", "id": 32, "method": "tools/list", "params": {}})

    follow_up = client.receive()
    assert follow_up["id"] == 32
    assert not select.select([client.process.stdout], [], [], 0.2)[0]

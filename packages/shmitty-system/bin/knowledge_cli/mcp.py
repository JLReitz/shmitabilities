"""Newline-delimited JSON-RPC server for packaged knowledge operations."""

import json
import sys
import threading
from dataclasses import dataclass, field
from typing import Any, Dict

from .errors import KnowledgeError
from .operations import (
    confidence_report,
    connections_report,
    investment_report,
    ontology_report,
    read_report,
    search_report,
    select_root,
    verification_report,
)


PROTOCOL_VERSION = "2025-11-25"


def _schema(
    properties: Dict[str, Dict[str, Any]], required=()
) -> Dict[str, Any]:
    result = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        result["required"] = list(required)
    return result


ROOT = {"type": "string", "minLength": 1}
DOCUMENT = {"type": "string", "minLength": 1}
AS_OF = {"type": "string", "minLength": 1}
TOOLS = (
    {
        "name": "knowledge_read",
        "description": "Read complete knowledge documents with ancestor context.",
        "inputSchema": _schema({
            "documents": {
                "type": "array",
                "items": DOCUMENT,
                "minItems": 1,
            },
            "root": ROOT,
        }, ("documents",)),
    },
    {
        "name": "knowledge_search",
        "description": "Find knowledge documents and return a complete TSV report.",
        "inputSchema": _schema({
            "tags": {"type": "array", "items": {"type": "string"}},
            "type": {"type": "string", "enum": ["Concept", "Reference"]},
            "subtype": {"type": "string", "minLength": 1},
            "root": ROOT,
        }),
    },
    {
        "name": "knowledge_connections",
        "description": "List authored and derived connections from one Concept.",
        "inputSchema": _schema(
            {"document": DOCUMENT, "root": ROOT}, ("document",)
        ),
    },
    {
        "name": "knowledge_confidence",
        "description": "Evaluate evidence coverage for one Concept.",
        "inputSchema": _schema({
            "document": DOCUMENT,
            "all": {"type": "boolean"},
            "root": ROOT,
        }, ("document",)),
    },
    {
        "name": "knowledge_investment",
        "description": "Evaluate authority for one Concept.",
        "inputSchema": _schema({
            "document": DOCUMENT,
            "as_of": AS_OF,
            "root": ROOT,
        }, ("document",)),
    },
    {
        "name": "knowledge_verify",
        "description": "Check one knowledge document and return all findings.",
        "inputSchema": _schema({
            "document": DOCUMENT,
            "as_of": AS_OF,
            "root": ROOT,
        }, ("document",)),
    },
    {
        "name": "knowledge_ontology",
        "description": "Inspect ontology terms, facts, or link requirements.",
        "inputSchema": _schema({
            "report": {
                "type": "string",
                "enum": ["terms", "facts", "requirements"],
            },
            "root": ROOT,
        }, ("report",)),
    },
)

for _tool in TOOLS:
    _tool["annotations"] = {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }


class InvalidArguments(Exception):
    """A tools/call argument object does not match its declared schema."""


class Cancelled(Exception):
    """A request was cooperatively cancelled."""


@dataclass
class RequestState:
    cancelled: threading.Event = field(default_factory=threading.Event)


class Server:
    """Serve concurrent read-only knowledge calls over standard I/O."""

    def __init__(self):
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._requests: Dict[Any, RequestState] = {}

    def serve(self) -> int:
        """Read protocol messages until standard input closes."""
        for line in sys.stdin:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                self._error(None, -32700, "Parse error")
                continue
            self._dispatch(message)
        return 0

    def _dispatch(self, message: Any) -> None:
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            self._error(None, -32600, "Invalid Request")
            return
        request_id = message.get("id")
        method = message.get("method")
        params = message.get("params", {})
        if "id" in message and (
            isinstance(request_id, bool)
            or not isinstance(request_id, (str, int, type(None)))
        ):
            self._error(None, -32600, "Invalid Request")
            return
        if not isinstance(method, str) or not isinstance(params, dict):
            if "id" in message:
                self._error(request_id, -32600, "Invalid Request")
            return
        if method == "notifications/initialized":
            return
        if method == "notifications/cancelled":
            self._cancel(params.get("requestId"))
            return
        if "id" not in message:
            return
        if method == "initialize":
            self._result(request_id, {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {
                    "name": "shmitty-knowledge",
                    "version": "0.1.0",
                },
            })
            return
        if method == "ping":
            self._result(request_id, {})
            return
        if method == "tools/list":
            self._result(request_id, {"tools": TOOLS})
            return
        if method == "tools/call":
            self._start_call(request_id, params)
            return
        self._error(request_id, -32601, "Method not found")

    def _start_call(self, request_id: Any, params: Dict[str, Any]) -> None:
        name = params.get("name")
        arguments = params.get("arguments", {})
        tools = {tool["name"]: tool for tool in TOOLS}
        if not isinstance(name, str) or name not in tools:
            self._error(request_id, -32601, "Method not found")
            return
        try:
            self._validate(arguments, tools[name]["inputSchema"])
        except InvalidArguments as exc:
            self._error(request_id, -32602, str(exc))
            return
        state = RequestState()
        with self._state_lock:
            if request_id in self._requests:
                self._error(request_id, -32600, "Duplicate request id")
                return
            self._requests[request_id] = state
        thread = threading.Thread(
            target=self._run_call,
            args=(request_id, state, name, arguments),
            daemon=True,
        )
        thread.start()

    def _run_call(
        self,
        request_id: Any,
        state: RequestState,
        name: str,
        arguments: Dict[str, Any],
    ) -> None:
        def trace(frame, event, arg):
            del frame, event, arg
            if state.cancelled.is_set():
                raise Cancelled()
            return trace

        try:
            sys.settrace(trace)
            text = self._execute(name, arguments)
            result = {"content": [{"type": "text", "text": text}]}
        except Cancelled:
            result = None
        except KnowledgeError as exc:
            result = {
                "content": [{"type": "text", "text": str(exc)}],
                "isError": True,
            }
        except Exception as exc:  # Protocol boundary: preserve diagnostics.
            print(
                f"shmitty-knowledge: {type(exc).__name__}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            result = {
                "content": [{
                    "type": "text",
                    "text": "Unexpected knowledge server failure",
                }],
                "isError": True,
            }
        finally:
            sys.settrace(None)
        with self._state_lock:
            self._requests.pop(request_id, None)
            cancelled = state.cancelled.is_set()
        if result is not None and not cancelled:
            self._result(request_id, result)

    @staticmethod
    def _execute(name: str, arguments: Dict[str, Any]) -> str:
        root = select_root(arguments.get("root"))
        if name == "knowledge_read":
            return read_report(root, arguments["documents"])
        if name == "knowledge_search":
            return search_report(
                root,
                arguments.get("tags", ()),
                arguments.get("type"),
                arguments.get("subtype"),
            )
        if name == "knowledge_connections":
            return connections_report(root, arguments["document"])
        if name == "knowledge_confidence":
            return confidence_report(
                root, arguments["document"], arguments.get("all", False)
            )
        if name == "knowledge_investment":
            return investment_report(
                root, arguments["document"], arguments.get("as_of")
            )
        if name == "knowledge_verify":
            return verification_report(
                root, arguments["document"], arguments.get("as_of")
            )[0]
        return ontology_report(root, arguments["report"])

    def _cancel(self, request_id: Any) -> None:
        with self._state_lock:
            state = self._requests.get(request_id)
            if state is not None:
                state.cancelled.set()

    @staticmethod
    def _validate(value: Any, schema: Dict[str, Any], path="arguments") -> None:
        expected = schema.get("type")
        if expected == "object":
            if not isinstance(value, dict):
                raise InvalidArguments(f"{path}: expected object")
            properties = schema.get("properties", {})
            unknown = set(value) - set(properties)
            if unknown:
                raise InvalidArguments(
                    f"{path}: unknown field: {sorted(unknown)[0]}"
                )
            for required in schema.get("required", ()):
                if required not in value:
                    raise InvalidArguments(
                        f"{path}: missing required field: {required}"
                    )
            for key, child in value.items():
                Server._validate(child, properties[key], f"{path}.{key}")
            return
        if expected == "array":
            if not isinstance(value, list):
                raise InvalidArguments(f"{path}: expected array")
            if len(value) < schema.get("minItems", 0):
                raise InvalidArguments(f"{path}: array is too short")
            for index, child in enumerate(value):
                Server._validate(child, schema["items"], f"{path}[{index}]")
            return
        if expected == "string":
            if not isinstance(value, str):
                raise InvalidArguments(f"{path}: expected string")
            if len(value) < schema.get("minLength", 0):
                raise InvalidArguments(f"{path}: string is too short")
        elif expected == "boolean" and not isinstance(value, bool):
            raise InvalidArguments(f"{path}: expected boolean")
        if "enum" in schema and value not in schema["enum"]:
            raise InvalidArguments(f"{path}: unsupported value")

    def _result(self, request_id: Any, result: Any) -> None:
        self._write({"jsonrpc": "2.0", "id": request_id, "result": result})

    def _error(self, request_id: Any, code: int, message: str) -> None:
        self._write({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        })

    def _write(self, message: Dict[str, Any]) -> None:
        with self._write_lock:
            print(
                json.dumps(message, separators=(",", ":")),
                file=sys.stdout,
                flush=True,
            )


def serve() -> int:
    """Run the packaged MCP server until its standard input closes."""
    return Server().serve()

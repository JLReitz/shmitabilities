import { HeadroomRuntime, metadataFromModelEvent } from "./runtime.ts";

const MCP_TOOL_NAMES = ["headroom_compress", "headroom_retrieve", "headroom_stats"] as const;

export default function (pi: any): void {
  const runtime = new HeadroomRuntime();

  for (const name of MCP_TOOL_NAMES) {
    pi.registerTool(createMcpTool(name, runtime));
  }

  pi.on("session_start", async (_event: unknown, ctx: any) => {
    await runtime.start(ctx, pi);
  });

  pi.on("model_select", async (event: any, ctx: any) => {
    await runtime.refreshRoute(ctx, pi, metadataFromModelEvent(event.model));
  });

  // Older Pi hosts emit a partial model_change event rather than model_select.
  pi.on("model_change" as any, async (event: any, ctx: any) => {
    await runtime.refreshRoute(ctx, pi, {
      modelId: event?.modelId,
      modelName: event?.modelId,
    });
  });

  pi.on("session_shutdown", async () => {
    await runtime.stop(pi);
  });
}

function createMcpTool(name: string, runtime: HeadroomRuntime): any {
  return {
    name,
    label: name.replace(/^headroom_/, "Headroom "),
    description: `Call Headroom MCP tool ${name}.`,
    promptSnippet: `${name}: Headroom MCP tool.`,
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
    async execute(_toolCallId: string, params: unknown) {
      try {
        const result = await runtime.callMcpTool(name, params);
        return {
          content: [{ type: "text" as const, text: formatToolResult(result) }],
          details: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          details: undefined,
          isError: true,
        };
      }
    },
  };
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result && Array.isArray((result as any).content)) {
    return (result as any).content
      .map((item: any) => (item?.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n");
  }
  return JSON.stringify(result, null, 2);
}

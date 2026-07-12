import { ToolResponse, toJSONSchema, type ToolModelContentPart } from "assistant-stream";
import type { ModelContext } from "@assistant-ui/react";

export interface FunctionToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Local OpenAI-compatible servers commonly implement only a small JSON Schema
 * subset for tools. Keep rich Zod validation in-app, but transmit just the
 * portable shape needed for tool selection.
 */
const UNSUPPORTED_TOOL_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "anyOf",
  "oneOf",
  "allOf",
  "prefixItems",
  "additionalProperties",
  "propertyNames",
  "enum",
]);

function withoutUnsupportedToolSchemaKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUnsupportedToolSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_TOOL_SCHEMA_KEYWORDS.has(key))
      .map(([key, nested]) => [key, key === "type" && nested === "integer" ? "number" : withoutUnsupportedToolSchemaKeywords(nested)])
  );
}

export function toFunctionToolDefs(
  tools: ModelContext["tools"]
): FunctionToolDef[] | undefined {
  if (!tools) return undefined;
  const defs = Object.entries(tools)
    .filter(([, t]) => t.parameters !== undefined)
    .map(([name, t]) => ({
      type: "function" as const,
      function: {
        name,
        description: t.description ?? "",
        parameters: withoutUnsupportedToolSchemaKeywords(toJSONSchema(t.parameters!)) as Record<string, unknown>,
      },
    }));
  return defs.length ? defs : undefined;
}

type ToolDef = NonNullable<ModelContext["tools"]>[string];

export function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined) return "<no result>";
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return String(result);
  }
}

export function parseToolArgsText(argsText: string, fallback: Record<string, unknown> = {}) {
  if (!argsText.trim()) return fallback;
  const parsed = JSON.parse(argsText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function stringifyModelContent(parts: readonly ToolModelContentPart[]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : stringifyToolResult(part)))
    .join("\n");
}

export function stringifyToolResultForModel(
  result: unknown,
  modelContent?: readonly ToolModelContentPart[]
): string {
  return modelContent ? stringifyModelContent(modelContent) : stringifyToolResult(result);
}

export async function normalizeToolResultForModel(
  tool: ToolDef | undefined,
  rawResult: unknown,
  args: Record<string, unknown>,
  toolCallId: string
) {
  const response = ToolResponse.toResponse(rawResult);
  let modelContent = response.modelContent;

  if (tool?.toModelOutput && !response.isError && modelContent === undefined) {
    try {
      modelContent = await tool.toModelOutput({
        toolCallId,
        input: args,
        output: response.result,
      });
    } catch (e) {
      console.warn(
        `[mach-design] tool "${toolCallId}" toModelOutput threw; falling back to result serialization.`,
        e
      );
    }
  }

  return {
    result: response.result,
    isError: response.isError,
    modelContent,
    modelText: stringifyToolResultForModel(response.result, modelContent),
  };
}

import type { OpenApiDocument } from "../api";
import { openApiEnglish } from "./openapi";

// Translate documentation prose without changing wire examples or field names.
export function localizeOpenApi(document: OpenApiDocument, language: string): OpenApiDocument {
  if (!language.startsWith("en")) return document;
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ["example", "examples", "enum", "const", "default"].includes(key) ? item
        : ["summary", "description", "title"].includes(key) && typeof item === "string" ? openApiEnglish[item] ?? item
          : visit(item),
    ]));
  }
  return visit(document) as OpenApiDocument;
}

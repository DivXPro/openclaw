import type { FieldMapping, ResourceConfig, UriSchemeConfig } from "./config.js";

export type ParsedUri = {
  scheme: string;
  resource: string;
  id: string;
};

export type ResolvedUri = {
  scheme: string;
  resource: string;
  id: string;
  webUrl: string;
  apiUrl?: string;
  display: Record<string, string>;
};

const URI_RE = /^(\w+):\/\/([^/]+)\/(.+)$/;

export function parseUri(uri: string): ParsedUri | null {
  const match = URI_RE.exec(uri);
  if (!match) return null;
  return {
    scheme: match[1],
    resource: match[2],
    id: match[3],
  };
}

function resolveTemplate(template: string, id: string): string {
  // Support both {id} and positional {0}/{1}/{2} for multi-segment ids
  const segments = id.split("/");
  return template
    .replace(/{id}/g, id)
    .replace(/{(\d+)}/g, (_, index) => segments[Number(index)] ?? "");
}

function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function extractFieldValue(
  data: Record<string, unknown>,
  mapping: FieldMapping,
): string | undefined {
  const raw = getValueAtPath(data, mapping.path);
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw);
  if (mapping.format) {
    return mapping.format.replace(/\$\{value\}/g, value);
  }
  return value;
}

export function extractDisplayFields(
  data: Record<string, unknown>,
  fields: Record<string, FieldMapping>,
): Record<string, string> {
  const display: Record<string, string> = {};
  for (const [key, mapping] of Object.entries(fields)) {
    const value = extractFieldValue(data, mapping);
    if (value !== undefined) {
      display[key] = value;
    }
  }
  return display;
}

export function resolveUri(
  uri: string,
  schemes: Record<string, UriSchemeConfig>,
): ResolvedUri | null {
  const parsed = parseUri(uri);
  if (!parsed) return null;

  const schemeConfig = schemes[parsed.scheme];
  if (!schemeConfig) return null;

  const resourceConfig = schemeConfig.resources[parsed.resource];
  if (!resourceConfig) return null;

  const resolved: ResolvedUri = {
    scheme: parsed.scheme,
    resource: parsed.resource,
    id: parsed.id,
    webUrl: resolveTemplate(resourceConfig.webUrlTemplate, parsed.id),
    display: {},
  };

  if (resourceConfig.apiUrlTemplate) {
    resolved.apiUrl = resolveTemplate(resourceConfig.apiUrlTemplate, parsed.id);
  }

  return resolved;
}

export type Deliverable = {
  uri: string;
  scheme: string;
  resource: string;
  id: string;
  _resolved: {
    webUrl: string;
    apiUrl?: string;
  };
  _display: Record<string, string>;
  [key: string]: unknown;
};

export function buildDeliverable(
  uri: string,
  rawData: Record<string, unknown>,
  schemes: Record<string, UriSchemeConfig>,
): Deliverable | null {
  const parsed = parseUri(uri);
  if (!parsed) return null;

  const schemeConfig = schemes[parsed.scheme];
  if (!schemeConfig) return null;

  const resourceConfig = schemeConfig.resources[parsed.resource];
  if (!resourceConfig) return null;

  const display = extractDisplayFields(rawData, resourceConfig.fields);

  return {
    uri,
    scheme: parsed.scheme,
    resource: parsed.resource,
    id: parsed.id,
    _resolved: {
      webUrl: resolveTemplate(resourceConfig.webUrlTemplate, parsed.id),
      ...(resourceConfig.apiUrlTemplate
        ? { apiUrl: resolveTemplate(resourceConfig.apiUrlTemplate, parsed.id) }
        : {}),
    },
    _display: display,
    ...rawData,
  };
}

export function extractDeliverablesFromMessages(
  messages: unknown[],
  schemes: Record<string, UriSchemeConfig>,
): Deliverable[] {
  const deliverables: Deliverable[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;

    // Look for uri in message details or content
    const uri = extractUriFromMessage(m);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);

    // Try to find associated JSON data in the same message or nearby
    const rawData = extractRawDataFromMessage(m);
    const deliverable = buildDeliverable(uri, rawData, schemes);
    if (deliverable) {
      deliverables.push(deliverable);
    }
  }

  return deliverables;
}

function extractUriFromMessage(msg: Record<string, unknown>): string | undefined {
  // Check details.uri first (for tool results that include structured data)
  const details = msg.details as Record<string, unknown> | undefined;
  if (details && typeof details.uri === "string") {
    return details.uri;
  }

  // Check content text for embedded uri
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        const text = (item as Record<string, unknown>).text as string;
        const match = URI_RE.exec(text);
        if (match) return match[0];
      }
    }
  }

  return undefined;
}

function extractRawDataFromMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const details = msg.details as Record<string, unknown> | undefined;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return details;
  }
  return {};
}

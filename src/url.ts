import { ParseUnsafeError } from "./errors.js";

export type HostScope = "internal" | "external";

export type ParsedUrl = {
  host: string;
  scope: HostScope;
};

export function parseAndClassifyUrl(input: string): ParsedUrl {
  if (input.includes("\0")) {
    throw new ParseUnsafeError("URL contains null byte");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ParseUnsafeError(`unparseable URL: ${input}`);
  }
  let rawHost = url.hostname.toLowerCase();
  if (!rawHost) {
    throw new ParseUnsafeError(`URL has no host: ${input}`);
  }
  // Strip surrounding brackets from IPv6 (Node retains them in hostname).
  if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
    rawHost = rawHost.slice(1, -1);
  }
  return { host: rawHost, scope: classifyHost(rawHost) };
}

function classifyHost(host: string): HostScope {
  if (host === "localhost") return "internal";
  if (host.endsWith(".local")) return "internal";
  if (isLoopbackIPv4(host)) return "internal";
  if (isPrivateIPv4(host)) return "internal";
  if (isLinkLocalIPv4(host)) return "internal";
  if (isLoopbackIPv6(host)) return "internal";
  if (isUniqueLocalIPv6(host)) return "internal";
  if (isLinkLocalIPv6(host)) return "internal";
  return "external";
}

function isLoopbackIPv4(host: string): boolean {
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLinkLocalIPv4(host: string): boolean {
  return /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isLoopbackIPv6(host: string): boolean {
  // Matches "::1" or "0:0:...:1" canonicalizations. Node's URL leaves "::1" unchanged.
  return host === "::1" || /^(0:){7}1$/.test(host);
}

function isUniqueLocalIPv6(host: string): boolean {
  // fc00::/7 — first byte 1111110x, so first 2 hex chars are fc or fd.
  return /^f[cd][0-9a-f]{0,2}:/.test(host);
}

function isLinkLocalIPv6(host: string): boolean {
  // fe80::/10 — first 10 bits 1111111010, so first 16 bits are fe80..febf.
  return /^fe[89ab][0-9a-f]?:/.test(host);
}

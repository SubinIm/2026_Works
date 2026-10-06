import type { MediaKind } from "./models.ts";
const HLS_MIMES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"]);
const DASH_MIMES = new Set(["application/dash+xml"]);
const TRACKING = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]);
const SECRET_QUERY = /^(token|access_token|auth|authorization|sig|signature|lsig|expires|expire|expiry|policy|key|spc|pot|ip|n)$/i;
export function pathExtension(raw: string): string {
  try { return new URL(raw).pathname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ""; } catch { return ""; }
}
export function mediaKind(raw: string, contentType = ""): MediaKind {
  let mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (!mime) try {
    const u = new URL(raw);
    if ((u.hostname === "googlevideo.com" || u.hostname.endsWith(".googlevideo.com")) && u.pathname === "/videoplayback" && !u.searchParams.has("sq") && !u.searchParams.has("range") && u.searchParams.get("sabr") !== "1") mime = u.searchParams.get("mime")?.toLowerCase() ?? "";
  } catch {}
  if (HLS_MIMES.has(mime) || pathExtension(raw) === ".m3u8") return "hls";
  if (DASH_MIMES.has(mime) || pathExtension(raw) === ".mpd") return "dash";
  if (mime === "video/mp4" || mime === "audio/mp4" || [".mp4", ".m4v"].includes(pathExtension(raw))) return "mp4";
  if (mime === "video/webm" || mime === "audio/webm" || pathExtension(raw) === ".webm") return "webm";
  return "unknown";
}
export function isSegment(raw: string, contentType = ""): boolean {
  try { const u=new URL(raw); if((u.hostname==="googlevideo.com"||u.hostname.endsWith(".googlevideo.com"))&&u.pathname==="/videoplayback"&&(u.searchParams.has("range")||u.searchParams.has("sq")))return true; } catch {}
  return [".ts", ".m4s", ".cmfv", ".cmfa"].includes(pathExtension(raw)) || contentType.toLowerCase().startsWith("video/mp2t");
}
export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw); u.hash = ""; u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  const entries = [...u.searchParams.entries()].filter(([k]) => !TRACKING.has(k.toLowerCase())).sort(([a,av],[b,bv]) => a.localeCompare(b) || av.localeCompare(bv));
  u.search = ""; for (const [k,v] of entries) u.searchParams.append(k,v); return u.toString();
}
export function isSignedUrl(raw: string): boolean { try { const u=new URL(raw); return [...u.searchParams.keys()].some(k => SECRET_QUERY.test(k)) || /\/(sig|lsig|token|expire)\//i.test(u.pathname); } catch { return false; } }
export function redactUrl(raw: string): string {
  try { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (SECRET_QUERY.test(k)) u.searchParams.set(k, "[REDACTED]"); u.pathname=u.pathname.replace(/\/(sig|lsig|token|expire|spc|ip)\/[^/]+/gi, '/$1/[REDACTED]'); return u.toString(); }
  catch { return "[INVALID_URL]"; }
}


export function isAllowedHostUrl(raw: string): boolean {
  try {
    const scheme = new URL(raw).protocol;
    return scheme === "http:" || scheme === "https:";
  } catch {
    return false;
  }
}

export function assertAllowedHostUrl(raw: string): void {
  if (!isAllowedHostUrl(raw)) {
    throw new Error("underlying_stream_required: 실제 HTTP(S) 미디어 주소가 필요합니다.");
  }
}

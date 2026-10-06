// Executed in the page's MAIN world by chrome.scripting. Keep this function
// self-contained: imported helpers are not available in the injected context.
export function scanPageMedia() {
  const youtube = location.hostname === 'youtube.com' || location.hostname.endsWith('.youtube.com');
  const items: { url: string; contentType?: string; source: "video-element" | "performance-entry" }[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown, source: "video-element" | "performance-entry", contentType?: string) => {
    if (typeof raw !== "string" || raw.length > 32768 || seen.has(raw)) return;
    try {
      const u = new URL(raw, location.href);
      if (!['http:', 'https:', 'blob:'].includes(u.protocol)) return;
      if (/\.(ts|m4s|cmfv|cmfa)$/i.test(u.pathname)) return;
      const googleMedia = (u.hostname === 'googlevideo.com' || u.hostname.endsWith('.googlevideo.com')) && u.pathname === '/videoplayback';
      // Chunk requests and SABR POST endpoints are not standalone files.
      if (googleMedia && (u.searchParams.has('sq') || u.searchParams.has('range') || u.searchParams.get('sabr') === '1')) return;
      const hint = contentType ?? (googleMedia ? u.searchParams.get('mime') ?? undefined : undefined);
      if (u.protocol !== 'blob:' && !/\.(m3u8|mpd|mp4|m4v|webm)$/i.test(u.pathname)
        && !/^(video|audio)\/(mp4|webm)(?:;|$)|^application\/(dash\+xml|vnd\.apple\.mpegurl|x-mpegurl)(?:;|$)/i.test(hint ?? '')) return;
      seen.add(raw); items.push({ url: /^https?:\/\//i.test(raw) ? raw : u.href, source, ...(hint ? { contentType: hint } : {}) });
    } catch { /* Ignore malformed page-provided values. */ }
  };
  for (const media of document.querySelectorAll<HTMLMediaElement>('video,audio')) add(media.currentSrc || media.src, 'video-element');
  // YouTube keeps old resource entries across video/Shorts SPA navigation. Its
  // current player response below is the only page-level identity we trust.
  if (!youtube) for (const entry of performance.getEntriesByType('resource')) add(entry.name, 'performance-entry');
  let sabrDetected = false;
  let unavailableDirectFormats = 0;
  if (youtube) {
    const activeId = new URL(location.href).searchParams.get('v') ?? location.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
    const page = window as any;
    let response = page.ytInitialPlayerResponse;
    try { response = (document.getElementById('movie_player') as any)?.getPlayerResponse?.() ?? response; } catch {}
    // Initial responses can belong to the previous video after SPA navigation.
    if (activeId && response?.videoDetails?.videoId === activeId) {
      const data = response.streamingData;
      add(data?.hlsManifestUrl, 'performance-entry', 'application/vnd.apple.mpegurl');
      add(data?.dashManifestUrl, 'performance-entry', 'application/dash+xml');
      const formats = [...(Array.isArray(data?.formats) ? data.formats : []), ...(Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [])].slice(0,500);
      for (const format of formats) {
        if (typeof format?.url === 'string') add(format.url, 'performance-entry', format.mimeType);
        else unavailableDirectFormats++;
      }
      sabrDetected = typeof data?.serverAbrStreamingUrl === 'string' && !!data.serverAbrStreamingUrl;
    }
  }
  return { pageUrl: location.href, pageTitle: document.title, items: items.slice(0,500), diagnostic: { sabrDetected, unavailableDirectFormats } };
}

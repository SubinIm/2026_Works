import { cleanMediaTitle, safeThumbnailUrl, type MediaMetadata } from "../shared/media-metadata.ts";
import { isSegment, mediaKind } from "../shared/url-utils.ts";

type Item = { url: string; source: "video-element" | "performance-entry" } & MediaMetadata;

let stopped = false;
let observer: MutationObserver | undefined;
let timer: number | undefined;

function hasRuntime(): boolean {
  try { return Boolean(chrome.runtime?.id); }
  catch { return false; }
}

function stop(): void {
  if (stopped) return;
  stopped = true;
  observer?.disconnect();
  if (timer !== undefined) clearInterval(timer);
}

function handleSendFailure(error: unknown): void {
  // Extension reloads invalidate old content scripts; they cannot reconnect.
  // A temporarily missing receiver, however, can recover on the next scan.
  if (!hasRuntime() || /extension context invalidated/i.test(String(error))) stop();
}

function collect(): void {
  if (stopped) return;
  if (!hasRuntime()) { stop(); return; }
  const found = new Map<string, Item>();
  const pageTitle = cleanMediaTitle(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content)
    ?? cleanMediaTitle(document.title);
  const pageImage = [
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[property="twitter:image"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[itemprop="thumbnailUrl"]')?.content,
  ].map(value => safeThumbnailUrl(value, location.href)).find(Boolean);
  const pageMetadata: MediaMetadata = {
    ...(pageTitle ? { mediaTitle: pageTitle, metadataSource: "page" as const } : {}),
    ...(pageImage ? { thumbnailUrl: pageImage, thumbnailSource: "page-image" as const } : {}),
  };
  for (const el of document.querySelectorAll<HTMLMediaElement>("video,audio")) {
    const url = el.currentSrc || el.src;
    if (!url) continue;
    const mediaTitle = cleanMediaTitle(el.getAttribute("aria-label")) ?? cleanMediaTitle(el.getAttribute("title"));
    const poster = safeThumbnailUrl(el.getAttribute("poster"), location.href);
    const item: Item = {
      url, source: "video-element", ...pageMetadata,
      ...(mediaTitle ? { mediaTitle, metadataSource: "video" as const } : {}),
      ...(poster ? { thumbnailUrl: poster, thumbnailSource: "video-poster" as const } : {}),
    };
    const previous = found.get(url);
    // A second element sharing the same source must not erase better metadata.
    if (previous?.metadataSource === "video" && !mediaTitle) {
      item.mediaTitle = previous.mediaTitle; item.metadataSource = "video";
    }
    if (previous?.thumbnailSource === "video-poster" && !poster) {
      item.thumbnailUrl = previous.thumbnailUrl; item.thumbnailSource = "video-poster";
    }
    found.set(url, item);
  }
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (!isSegment(entry.name) && mediaKind(entry.name) !== "unknown") {
      if (!found.has(entry.name)) found.set(entry.name, { url: entry.name, source: "performance-entry", ...pageMetadata });
    }
  }
  try {
    chrome.runtime.sendMessage({
      type: "content_candidates", pageUrl: location.href, pageTitle: document.title,
      pageMetadata, referrer: document.referrer, userAgent: navigator.userAgent, items: [...found.values()],
    }).catch(handleSendFailure);
  } catch (error) {
    // sendMessage can throw before returning a Promise when its context is gone.
    handleSendFailure(error);
  }
}

collect();
if (!stopped) {
  observer = new MutationObserver(collect);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src", "poster", "title", "aria-label", "content"],
  });
  timer = setInterval(collect, 5000);
}


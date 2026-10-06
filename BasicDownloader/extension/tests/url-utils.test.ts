import test from "node:test";import assert from "node:assert/strict";import {canonicalizeUrl,isSegment,isSignedUrl,mediaKind,redactUrl} from "../src/shared/url-utils.ts";
test("URL and MIME media detection",()=>{assert.equal(mediaKind("https://x/a.m3u8?token=1"),"hls");assert.equal(mediaKind("https://x/noext","application/dash+xml; charset=utf-8"),"dash");assert.equal(mediaKind("https://x/a","video/mp4"),"mp4");assert.equal(isSegment("https://x/chunk.m4s?q=1"),true);});
test("canonical URL retains signed parameters and sorts query",()=>{assert.equal(canonicalizeUrl("HTTPS://EXAMPLE.COM:443/a.m3u8?z=2&utm_source=x&token=abc&a=1#x"),"https://example.com/a.m3u8?a=1&token=abc&z=2");assert.equal(isSignedUrl("https://x/a?signature=s"),true);});
test("sensitive URL values are redacted",()=>{const v=redactUrl("https://x/a?token=secret&quality=hd");assert.ok(!v.includes("secret"));assert.ok(v.includes("quality=hd"));});
test('extensionless Google media MIME is recovered without accepting chunks or arbitrary sites',()=>{
  assert.equal(mediaKind('https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4'),'mp4');
  assert.equal(mediaKind('https://rr.googlevideo.com/videoplayback?mime=audio%2Fwebm'),'webm');
  assert.equal(mediaKind('https://evil.test/videoplayback?mime=video%2Fmp4'),'unknown');
  for(const suffix of ['&sq=1','&range=0-100'])assert.equal(isSegment('https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4'+suffix),true);
  assert.equal(mediaKind('https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4','application/vnd.yt-ump'),'unknown');
});
test('path signatures and Google query credentials are redacted without mutating the original',()=>{
  const url='https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/123/sig/SECRET/lsig/SECRET2/playlist/index.m3u8?ip=PRIVATE&spc=TOKEN&quality=hd';
  assert.equal(isSignedUrl(url),true);const safe=redactUrl(url);
  for(const secret of ['SECRET','PRIVATE','TOKEN'])assert.ok(!safe.includes(secret));
  assert.ok(safe.includes('quality=hd'));assert.ok(url.includes('/sig/SECRET/'));
});


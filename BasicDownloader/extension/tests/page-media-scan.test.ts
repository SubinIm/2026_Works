import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { scanPageMedia } from '../src/background/page-media-scan.ts';

function scan(response?:unknown, resources:string[]=[], href='https://www.youtube.com/watch?v=current', currentResponse?:unknown) {
  return runInNewContext(`(${scanPageMedia.toString()})()`, {
    URL, location:new URL(href), window:{ytInitialPlayerResponse:response},
    document:{title:'Video title',querySelectorAll:()=>[{currentSrc:'blob:https://www.youtube.com/internal'}],getElementById:()=>currentResponse?{getPlayerResponse:()=>currentResponse}:null},
    performance:{getEntriesByType:()=>resources.map(name=>({name}))}
  });
}
test('page scan distinguishes SABR-only playback without exposing its signed endpoint',()=>{
  const result=scan({videoDetails:{videoId:'current'},streamingData:{serverAbrStreamingUrl:'https://secret.test/private?token=SECRET',adaptiveFormats:[{itag:137,mimeType:'video/mp4'},{itag:140,mimeType:'audio/mp4'}]}});
  assert.equal(result.diagnostic.sabrDetected,true);
  assert.equal(result.diagnostic.unavailableDirectFormats,2);
  assert.equal(result.items.length,1);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('page scan recovers provided manifests and direct files without creating URLs',()=>{
  const result=scan({videoDetails:{videoId:'current'},streamingData:{hlsManifestUrl:'https://cdn.test/master',dashManifestUrl:'https://cdn.test/manifest',adaptiveFormats:[{url:'https://cdn.test/audio',mimeType:'audio/webm'},{signatureCipher:'url=https://secret.test/encrypted'}]}});
  assert.equal(result.items.length,4);
  assert.equal(result.items[1].contentType,'application/vnd.apple.mpegurl');
  assert.equal(result.items[3].contentType,'audio/webm');
  assert.ok(!JSON.stringify(result).includes('encrypted'));
});
test('SPA scan uses current player response and rejects a stale initial response',()=>{
  const stale={videoDetails:{videoId:'old'},streamingData:{hlsManifestUrl:'https://cdn.test/old.m3u8'}};
  assert.equal(scan(stale).items.length,1);
  const current={videoDetails:{videoId:'current'},streamingData:{dashManifestUrl:'https://cdn.test/new.mpd'}};
  assert.equal(scan(stale,[],undefined,current).items[1].url,'https://cdn.test/new.mpd');
});
test('Shorts identity is scoped to the active video',()=>{
  const result=scan({videoDetails:{videoId:'short'},streamingData:{serverAbrStreamingUrl:'https://private.test'}},[],'https://www.youtube.com/shorts/short');
  assert.equal(result.diagnostic.sabrDetected,true);
});
test('resource recovery accepts extensionless typed media but excludes chunks and opaque endpoints',()=>{
  const result=scan(undefined,[
    'https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4&sig=original',
    'https://rr.googlevideo.com/videoplayback?mime=audio%2Fwebm',
    'https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4&range=0-100',
    'https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4&sq=2',
    'https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4&sabr=1',
    'https://rr.googlevideo.com/videoplayback?opaque=1',
    'https://cdn.test/chunk.m4s','https://cdn.test/a.ts','https://cdn.test/valid.mpd',
    'https://evil.test/videoplayback?mime=video%2Fmp4'
  ],'https://player.test/watch');
  assert.equal(result.items.length,4);
  assert.equal(result.items[1].url,'https://rr.googlevideo.com/videoplayback?mime=video%2Fmp4&sig=original');
});
test('YouTube resource history cannot assign the previous video to the current page',()=>{
  const result=scan({videoDetails:{videoId:'current'},streamingData:{serverAbrStreamingUrl:'https://private.test'}},['https://cdn.test/previous-video.m3u8']);
  assert.equal(result.items.length,1);
  assert.equal(result.diagnostic.sabrDetected,true);
});

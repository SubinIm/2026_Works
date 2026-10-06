export const playerData = () => ({
  adPlacements: [{ marker: 'pre-roll' }], adSlots: [{ marker: 'mid-roll' }], playerAds: [{ marker: 'legacy' }],
  videoDetails: { videoId: 'fixture-main', title: 'Normal video', lengthSeconds: '120' },
  streamingData: { formats: [{ url: 'https://media.test/main?signature=preserved' }] },
  captions: { captionTracks: [{ languageCode: 'ko' }] }, playabilityStatus: { status: 'OK' },
});
export const fixtureHtml = `<!doctype html><meta charset="utf-8"><body>
<main>Normal article and comments remain</main>
<div id="movie_player" class="html5-video-player" style="width:640px;height:360px">
<video muted playsinline style="width:320px;height:180px"></video>
<button class="ytp-ad-skip-button-modern" onclick="window.skips++;this.parentNode.classList.remove('ad-showing','ad-interrupting')">Skip ad</button></div>
<script>
window.skips=0;
window.ytInitialPlayerResponse=${JSON.stringify(playerData())};
window.boot=JSON.parse(JSON.stringify(window.ytInitialPlayerResponse));
window.fetchBoot=String(fetch);window.xhrBoot=String(XMLHttpRequest.prototype.open);
window.timeEvents=0;
document.querySelector('video').addEventListener('seeking',()=>window.timeEvents++);
</script>`;
export async function routeFixture(page) {
  await page.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/watch' || url.pathname.startsWith('/shorts/')) {
      let body = fixtureHtml;
      if (url.searchParams.get('transport') === 'sabr') {
        const data = playerData();
        data.streamingData.serverAbrStreamingUrl = 'https://media.test/serverabr?signature=preserved';
        data.adBreakHeartbeatParams = { marker: 'contract' };
        body = body.replace(JSON.stringify(playerData()), JSON.stringify(data));
      }
      return route.fulfill({ contentType: 'text/html', body });
    }
    const mode = url.searchParams.get('mode');
    let data = playerData();
    if (mode === 'sabr' || mode === 'sabr-nested') {
      data.streamingData.serverAbrStreamingUrl = 'https://media.test/serverabr?signature=preserved';
      data.adBreakHeartbeatParams = { marker: 'contract' };
      if (mode === 'sabr-nested') data = { adSlots: [{ marker: 'outer contract' }], response: [{ playerResponse: data }] };
    }
    if (mode === 'plain') { delete data.adPlacements; delete data.adSlots; delete data.playerAds; }
    if (mode === 'nested') data = [{ playerResponse: data }, { unrelated: 'keep' }];
    if (mode === 'shorts') data = { entries: [
      { command: { reelWatchEndpoint: { adClientParams: { isAd: true }, videoId: 'ad' } } },
      { command: { reelWatchEndpoint: { adClientParams: { isAd: false }, videoId: 'main', playerResponse: playerData() } } },
      { command: { reelWatchEndpoint: { videoId: 'another' } } },
    ] };
    if (mode === 'error') data.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Sign in required' };
    const body = mode === 'invalid' ? '<html>Not JSON</html>' : (mode === 'xssi' ? ")]}'\n" : '') + JSON.stringify(data);
    return route.fulfill({ status: mode === 'error' ? 403 : 200,
      headers: { 'content-type': 'application/json', 'x-fixture': 'preserved', 'etag': 'old-body' }, body });
  });
}

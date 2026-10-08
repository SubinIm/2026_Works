import {trackTabVisit} from './visit-tracker.js';
import {setTrackingEnabled,trackingEnabled} from './tracking-settings.js';
// Register synchronously. Preferences and counters live in IndexedDB across worker restarts.
chrome.tabs.onActivated.addListener(async({tabId})=>{try{if(await trackingEnabled())return await trackTabVisit(await chrome.tabs.get(tabId),'auto-focus');}catch{}});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(change.status==='complete')return trackTabVisit(tab,'auto-load').catch(()=>{});});
chrome.permissions.onRemoved.addListener(p=>{if(p.permissions?.includes('tabs'))return setTrackingEnabled(false).catch(()=>{});});

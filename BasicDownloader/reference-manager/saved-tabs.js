import { recordKeys } from './model.js';
import { fromTab, resourceIdentity } from './organizer.js';

export function planSavedTabs(tabs,records){
 const out=[];
 for(const tab of tabs){const item=fromTab(tab);if(!item.record || tab.pinned || tab.incognito)continue;
  const keys=recordKeys(item.record),match=records.find(r=>recordKeys(r).some(k=>keys.includes(k)));if(!match)continue;
  const target=match.linkedTo?records.find(r=>r.id===match.linkedTo):match;if(!target)continue;
  out.push({tabId:tab.id,url:tab.url,identity:resourceIdentity(tab.url),recordId:match.id,title:tab.title || item.record.title,selected:true});
 }
 return out;
}
export async function closeSavedTabs(candidates,{tabs,readRecords}){
 const result={closed:0,skipped:0,failed:0};
 // Recheck each tab and its saved record immediately before closing it.
 for(const item of candidates){if(!item.selected)continue;
  try{const records=await readRecords(item.recordId),tab=await tabs.get(item.tabId);
   const current=planSavedTabs([tab],records)[0];
   if(!current || current.identity!==item.identity || current.recordId!==item.recordId || tab.url!==item.url || tab.pendingUrl || tab.audible){result.skipped++;continue;}
   await tabs.remove(item.tabId);result.closed++;
  }catch{result.failed++;}
 }
 return result;
}

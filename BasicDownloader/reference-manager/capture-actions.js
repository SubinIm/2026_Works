import {all,get,applyMetadata} from './db.js';import {normalize} from './model.js';import {metadataPreview} from './bibliography.js';
export async function saveCapture(record,{targetId,beforeVersion}={}){
 const input=normalize(record),records=await all();let plan;
 if(targetId)plan={record:input,targetId,beforeVersion,bibliographySource:record.metadataStatus || '팝업·사이드바에서 확인'};
 else{plan=metadataPreview({record:input,tabIds:[],sourceUrl:input.url},record,records);if(!plan.metadataReady)throw Error(plan.reason);plan.record.collection=input.collection;plan.record.tags=input.tags;}
 const result=await applyMetadata([plan]);if(!result.added && !result.changed)throw Error('저장된 자료가 변경되었거나 DOI가 다른 자료와 겹칩니다. 현재 탭 불러오기로 최신 자료를 확인해주세요.');
 return {result,record:await get(plan.targetId || plan.record.id)};
}

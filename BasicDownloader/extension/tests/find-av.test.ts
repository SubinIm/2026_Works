import test from "node:test";
import assert from "node:assert/strict";
import { findAudioVideo } from "../src/background/find-av.ts";
import { detectCandidate } from "../src/background/candidate-detector.ts";
const item=(name:string)=>detectCandidate({url:`https://fixture.test/${name}.m3u8`,tabId:1,timestamp:1})!;
test("full scan rechecks stale negative and positive summaries instead of stopping at stale AV",async()=>{
  const first={...item("stale-positive"),probeSummary:{videoCount:1,audioCount:1}};
  const second={...item("stale-negative"),probeSummary:{videoCount:1,audioCount:0}};
  const calls:string[]=[];
  const result=await findAudioVideo([first,second],async c=>{
    calls.push(c.id);
    return {type:"probe_result",payload:{selectedStreamIndices:c.id===first.id?[0]:[0,1],videoStreams:[{index:0}],audioStreams:c.id===first.id?[]:[{index:1}]}};
  },true);
  assert.equal(result.candidateId,second.id);assert.equal(calls.length,2);
});
test("all mode probes beyond first success and twenty candidates and chooses best verified AV",async()=>{
  const items=Array.from({length:25},(_,i)=>item(String(i)));
  let count=0;
  const result=await findAudioVideo(items,async c=>{
    count++;
    return {type:"probe_result",payload:{selectedStreamIndices:[0,1],videoStreams:[{index:0,width:1920,height:c.id===items[24].id?1080:360}],audioStreams:[{index:1}]}};
  },true);
  assert.equal(count,25);assert.equal(result.candidateId,items[24].id);assert.equal(result.limited,false);
});
test("AV search skips silent/error candidates and stops at first linked AV result",async()=>{
  const items=[item("one"),item("two"),item("three"),item("four")];
  const calls:string[]=[];
  const result=await findAudioVideo(items,async c=>{
    calls.push(c.id);
    if(c.id===items[0].id)throw new Error("403");
    return {type:"probe_result",payload:{selectedStreamIndices:c.id===items[1].id?[0]:[0,1],videoStreams:[{index:0}],audioStreams:[{index:1}]}};
  });
  assert.equal(result.candidateId,items[2].id);assert.equal(calls.length,3);assert.equal(result.failed,1);
});
test("AV search respects verified results, blocks blob/ad candidates, and bounds attempts",async()=>{
  const good={...item("good"),probeSummary:{videoCount:1,audioCount:1}};
  assert.equal((await findAudioVideo([good],async()=>{throw new Error("must not probe");})).candidateId,good.id);
  const blob={...item("blob"),url:"blob:https://fixture.test/x"};
  const ad=item("ads");ad.flags.likelyAdvertisement=true;
  let count=0;
  const result=await findAudioVideo([blob,ad,...Array.from({length:25},(_,i)=>item(String(i)))],async()=>{count++;return {type:"protocol_error"};});
  assert.equal(count,20);assert.equal(result.candidateId,null);assert.equal(result.limited,true);assert.equal(result.failed,20);
});

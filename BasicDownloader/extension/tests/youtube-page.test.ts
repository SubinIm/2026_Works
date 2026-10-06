import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubePageUrl } from '../src/shared/youtube-page.ts';
test('YouTube engine uses canonical video pages, never blob, credentials or other sites',()=>{
  const target='https://www.youtube.com/watch?v=D2cUkF-MPJU';
  for(const url of [target+'&list=private&token=SECRET','https://youtu.be/D2cUkF-MPJU?t=3','https://www.youtube.com/shorts/D2cUkF-MPJU'])assert.equal(youtubePageUrl(url),target);
  for(const url of ['blob:'+target,'data:text/html,test','file:///youtube','https://youtube.com.evil.test/watch?v=D2cUkF-MPJU','http://www.youtube.com/watch?v=D2cUkF-MPJU','https://u:p@youtube.com/watch?v=D2cUkF-MPJU','https://www.youtube.com/playlist?list=x'])assert.equal(youtubePageUrl(url),undefined);
});

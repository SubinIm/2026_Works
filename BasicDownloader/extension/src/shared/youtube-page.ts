// Page URLs are an explicit engine input, not a promotion of blob or POST URLs.
export function youtubePageUrl(raw:string):string|undefined {
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return;
    const id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)?
      u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.startsWith('/shorts/')?u.pathname.slice(8):undefined:undefined;
    if(id&&/^[A-Za-z0-9_-]{11}$/.test(id))return `https://www.youtube.com/watch?v=${id}`;
  }catch{}
}

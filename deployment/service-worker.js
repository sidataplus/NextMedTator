/* Cache only immutable public app assets. Never cache clinical projects or arbitrary GETs. */
const BUILD='__BUILD_HASH__',CACHE=`nextmedtator-app-${BUILD}`;
const allowed=new Set();
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(new URL('asset-manifest.json',self.registration.scope),{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw Error('App manifest unavailable');const manifest=await response.json();if(manifest.version!==BUILD)throw Error('App release mismatch');
  const cache=await caches.open(CACHE);
  try{
    for(const asset of manifest.assets){
      const url=new URL(asset.path,self.registration.scope);if(url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope)||asset.path.includes('..'))throw Error('Invalid public asset path');
      const r=await fetch(url,{cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('Incomplete offline install');const bytes=await r.arrayBuffer();if(bytes.byteLength!==asset.bytes)throw Error('Asset length mismatch');
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==asset.sha256)throw Error('Asset integrity mismatch');
      await cache.put(url,new Response(bytes,{headers:r.headers,status:200}));
    }
    await cache.put(new URL('asset-manifest.json',self.registration.scope),new Response(JSON.stringify(manifest),{headers:{'Content-Type':'application/json'}}));
  }catch(e){await caches.delete(CACHE);throw e;}
  // No skipWaiting: an active review session remains on its installed application version.
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);if(url.href===self.registration.scope)url.pathname+='index.html';const cached=await cache.match(url.href,{ignoreSearch:false});return cached??fetch(request);})());
});

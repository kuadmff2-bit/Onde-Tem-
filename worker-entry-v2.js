import enhancedApi from './worker-entry.js';
import baseApp from './worker.js';

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}

async function currentUser(request,env){
  const url=new URL(request.url);
  url.pathname='/api/auth/me';
  url.search='';
  const response=await enhancedApi.fetch(new Request(url,{method:'GET',headers:request.headers}),env);
  if(!response.ok)return null;
  const data=await response.json().catch(()=>({}));
  return data.user||null;
}

async function visibleOwnListings(request,env){
  const user=await currentUser(request,env);
  if(!user)return json({error:'Entre na sua conta para continuar.'},401);
  const r=await env.DB.prepare(`
    SELECT id,title,status,price,category,condition_text AS condition,city,description,image_url,created_at
    FROM listings
    WHERE user_id=? AND status<>'sold'
    ORDER BY created_at DESC
  `).bind(user.id).all();
  return json({items:r.results});
}

async function visibleOwnBusinesses(request,env){
  const user=await currentUser(request,env);
  if(!user)return json({error:'Entre na sua conta para continuar.'},401);
  const r=await env.DB.prepare(`
    SELECT id,kind,name,status,category,city,address,hours,description,image_url,created_at
    FROM businesses
    WHERE user_id=? AND status<>'rejected'
    ORDER BY created_at DESC
  `).bind(user.id).all();
  return json({items:r.results});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if(url.pathname==='/api/me/listings'&&request.method==='GET'){
      return visibleOwnListings(request,env);
    }
    if(url.pathname==='/api/me/businesses'&&request.method==='GET'){
      return visibleOwnBusinesses(request,env);
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      return enhancedApi.fetch(request, env);
    }

    const response = await baseApp.fetch(request, env);
    const headers = new Headers(response.headers);
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self)');

    if ((headers.get('content-type') || '').includes('text/html')) {
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
      headers.set('pragma', 'no-cache');
      headers.set('expires', '0');
      const htmlResponse=new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      return new HTMLRewriter()
        .on('script[src*="enhancements.js"]',{element(e){e.setAttribute('src','/enhancements.js?v=20260902-3')}})
        .transform(htmlResponse);
    }

    if(url.pathname==='/enhancements.js'||url.pathname==='/enhancements.css'){
      headers.set('cache-control','no-cache, no-store, must-revalidate');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

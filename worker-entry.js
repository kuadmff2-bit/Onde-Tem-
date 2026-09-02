import app from './worker.js';

const MAX_IMAGE=5*1024*1024;

function securityHeaders(){return{
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=(self)',
  'strict-transport-security':'max-age=31536000; includeSubDomains'
}}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...securityHeaders(),...headers}})}
function cleanText(v,max){return String(v??'').trim().replace(/[\u0000-\u001F\u007F]/g,' ').slice(0,max)}
function normalizePhone(v){let d=String(v??'').replace(/\D/g,'');if(d.length===10||d.length===11)d='55'+d;if(!/^55\d{10,11}$/.test(d))throw new Error('Informe um WhatsApp válido com DDD.');return d}
function b64ToBytes(v){const s=atob(v);return Uint8Array.from(s,c=>c.charCodeAt(0))}
function bytesToB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
async function hashPassword(password,saltB64){const salt=b64ToBytes(saltB64);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);return bytesToB64(new Uint8Array(bits))}
function timingSafe(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function numberOrNull(v,min,max){if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null}

async function getCurrentUser(request,env){const url=new URL(request.url);url.pathname='/api/auth/me';url.search='';const res=await app.fetch(new Request(url,{method:'GET',headers:request.headers}),env);if(!res.ok)return{response:res,user:null};const data=await res.json();if(!data.user)return{response:json({error:'Entre na sua conta para continuar.'},401),user:null};return{response:null,user:data.user}}
async function requireUser(request,env){const auth=await getCurrentUser(request,env);if(auth.response)return auth;return auth}
async function uploadImage(form,env){const file=form.get('image');if(!file||typeof file==='string'||file.size===0)return null;if(!env.MEDIA)throw new Error('O armazenamento de imagens não está disponível.');if(file.size>MAX_IMAGE)throw new Error('A imagem deve ter no máximo 5 MB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use imagem JPG, PNG ou WebP.');const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];const key=`uploads/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:'public, max-age=31536000, immutable'}});return`/media/${key}`}

async function createListing(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;try{const f=await request.formData();const title=cleanText(f.get('title'),90),category=cleanText(f.get('category'),50),condition=cleanText(f.get('condition'),20),city=cleanText(f.get('city'),70),description=cleanText(f.get('description'),1000),price=Number(f.get('price'));if(title.length<3||!category||!condition||!city||description.length<10)throw new Error('Preencha todos os campos do anúncio.');if(!Number.isFinite(price)||price<0||price>99999999)throw new Error('Preço inválido.');const latitude=numberOrNull(f.get('latitude'),-90,90),longitude=numberOrNull(f.get('longitude'),-180,180);const image=await uploadImage(f,env);try{await env.DB.prepare('INSERT INTO listings (user_id,title,category,price,condition_text,city,description,image_url,status,latitude,longitude) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(auth.user.id,title,category,price,condition,city,description,image,'pending',latitude,longitude).run()}catch(e){if(!String(e?.message||e).toLowerCase().includes('latitude'))throw e;await env.DB.prepare('INSERT INTO listings (user_id,title,category,price,condition_text,city,description,image_url,status) VALUES (?,?,?,?,?,?,?,?,?)').bind(auth.user.id,title,category,price,condition,city,description,image,'pending').run()}return json({ok:true},201)}catch(e){return json({error:e?.message||'Não foi possível criar o anúncio.'},400)}}

async function createBusiness(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;try{const f=await request.formData();const name=cleanText(f.get('name'),100),type=cleanText(f.get('type'),20),category=cleanText(f.get('category'),50),city=cleanText(f.get('city'),70),address=cleanText(f.get('address'),160),hours=cleanText(f.get('hours'),100),description=cleanText(f.get('description'),800);if(name.length<2||!['business','professional'].includes(type)||!category||!city||!address||description.length<10)throw new Error('Preencha todos os campos obrigatórios.');const latitude=numberOrNull(f.get('latitude'),-90,90),longitude=numberOrNull(f.get('longitude'),-180,180);const image=await uploadImage(f,env);try{await env.DB.prepare('INSERT INTO businesses (user_id,kind,name,category,city,address,hours,description,image_url,status,latitude,longitude) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(auth.user.id,type,name,category,city,address,hours,description,image,'pending',latitude,longitude).run()}catch(e){if(!String(e?.message||e).toLowerCase().includes('latitude'))throw e;await env.DB.prepare('INSERT INTO businesses (user_id,kind,name,category,city,address,hours,description,image_url,status) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(auth.user.id,type,name,category,city,address,hours,description,image,'pending').run()}return json({ok:true},201)}catch(e){return json({error:e?.message||'Não foi possível cadastrar o negócio.'},400)}}

async function catalog(env,url){const q=cleanText(url.searchParams.get('q'),80),like=`%${q}%`;try{const [businesses,listings]=await Promise.all([
 env.DB.prepare(`SELECT b.id,b.kind,b.name,b.category,b.city,b.address,b.hours,b.description,b.image_url,b.featured,b.rating,b.latitude,b.longitude,u.phone FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.status='published' AND (?='' OR b.name LIKE ? OR b.category LIKE ? OR b.description LIKE ?) ORDER BY b.featured DESC,b.created_at DESC LIMIT 80`).bind(q,like,like,like).all(),
 env.DB.prepare(`SELECT l.id,l.title,l.category,l.price,l.condition_text AS condition,l.city,l.description,l.image_url,l.latitude,l.longitude,u.phone FROM listings l JOIN users u ON u.id=l.user_id WHERE l.status='published' AND (?='' OR l.title LIKE ? OR l.category LIKE ? OR l.description LIKE ?) ORDER BY l.created_at DESC LIMIT 100`).bind(q,like,like,like).all()
 ]);return json({businesses:businesses.results,listings:listings.results})}catch(e){const [businesses,listings]=await Promise.all([
 env.DB.prepare(`SELECT b.id,b.kind,b.name,b.category,b.city,b.address,b.hours,b.description,b.image_url,b.featured,b.rating,u.phone FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.status='published' AND (?='' OR b.name LIKE ? OR b.category LIKE ? OR b.description LIKE ?) ORDER BY b.featured DESC,b.created_at DESC LIMIT 80`).bind(q,like,like,like).all(),
 env.DB.prepare(`SELECT l.id,l.title,l.category,l.price,l.condition_text AS condition,l.city,l.description,l.image_url,u.phone FROM listings l JOIN users u ON u.id=l.user_id WHERE l.status='published' AND (?='' OR l.title LIKE ? OR l.category LIKE ? OR l.description LIKE ?) ORDER BY l.created_at DESC LIMIT 100`).bind(q,like,like,like).all()
 ]);return json({businesses:businesses.results,listings:listings.results})}}

async function fullFavorites(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;const r=await env.DB.prepare(`
SELECT f.id AS favorite_id,f.kind,f.item_id,f.created_at,
 CASE WHEN f.kind='listing' THEN l.title ELSE b.name END AS name,
 CASE WHEN f.kind='listing' THEN l.category ELSE b.category END AS category,
 CASE WHEN f.kind='listing' THEN l.city ELSE b.city END AS city,
 CASE WHEN f.kind='listing' THEN l.description ELSE b.description END AS description,
 CASE WHEN f.kind='listing' THEN l.image_url ELSE b.image_url END AS image_url,
 CASE WHEN f.kind='listing' THEN l.status ELSE b.status END AS status,
 CASE WHEN f.kind='listing' THEN l.price ELSE NULL END AS price,
 CASE WHEN f.kind='listing' THEN l.condition_text ELSE NULL END AS condition,
 CASE WHEN f.kind='business' THEN b.address ELSE NULL END AS address,
 CASE WHEN f.kind='business' THEN b.hours ELSE NULL END AS hours,
 CASE WHEN f.kind='listing' THEN lu.phone ELSE bu.phone END AS phone,
 CASE WHEN (f.kind='listing' AND l.status='published') OR (f.kind='business' AND b.status='published') THEN 1 ELSE 0 END AS available
FROM favorites f
LEFT JOIN listings l ON f.kind='listing' AND l.id=f.item_id
LEFT JOIN users lu ON lu.id=l.user_id
LEFT JOIN businesses b ON f.kind='business' AND b.id=f.item_id
LEFT JOIN users bu ON bu.id=b.user_id
WHERE f.user_id=? ORDER BY f.created_at DESC`).bind(auth.user.id).all();return json({items:r.results})}

async function myListings(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;const r=await env.DB.prepare('SELECT id,title,status,price,category,condition_text AS condition,city,description,image_url,created_at FROM listings WHERE user_id=? ORDER BY created_at DESC').bind(auth.user.id).all();return json({items:r.results})}
async function myBusinesses(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;const r=await env.DB.prepare('SELECT id,kind,name,status,category,city,address,hours,description,image_url,created_at FROM businesses WHERE user_id=? ORDER BY created_at DESC').bind(auth.user.id).all();return json({items:r.results})}

async function archiveOwnItem(request,env){const auth=await requireUser(request,env);if(auth.response)return auth.response;try{const body=await request.json();const kind=cleanText(body.kind,20),id=Number(body.id);if(!Number.isInteger(id)||!['listing','business'].includes(kind))return json({error:'Publicação inválida.'},400);if(kind==='listing'){const r=await env.DB.prepare("UPDATE listings SET status='sold' WHERE id=? AND user_id=?").bind(id,auth.user.id).run();if(!r.meta.changes)return json({error:'Anúncio não encontrado.'},404)}else{const r=await env.DB.prepare("UPDATE businesses SET status='rejected' WHERE id=? AND user_id=?").bind(id,auth.user.id).run();if(!r.meta.changes)return json({error:'Cadastro não encontrado.'},404)}return json({ok:true})}catch(e){return json({error:e?.message||'Não foi possível remover a publicação.'},400)}}

async function updateProfile(request,env){try{const auth=await getCurrentUser(request,env);if(auth.response)return auth.response;const user=auth.user;const body=await request.json();const name=cleanText(body.name,100);const phone=normalizePhone(body.phone);const currentPassword=String(body.currentPassword??'');if(name.length<3)return json({error:'Informe seu nome completo.'},400);if(currentPassword.length<8||currentPassword.length>72)return json({error:'Informe sua senha atual.'},400);const row=await env.DB.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').bind(user.id).first();if(!row)return json({error:'Conta não encontrada.'},404);const hash=await hashPassword(currentPassword,row.password_salt);if(!timingSafe(hash,row.password_hash))return json({error:'A senha atual está incorreta.'},400);const duplicate=await env.DB.prepare('SELECT id FROM users WHERE phone=? AND id<>?').bind(phone,user.id).first();if(duplicate)return json({error:'Este WhatsApp já está cadastrado em outra conta.'},409);await env.DB.prepare('UPDATE users SET name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,phone,user.id).run();return json({user:{...user,name,phone}})}catch(e){return json({error:e?.message||'Não foi possível atualizar seus dados.'},400)}}

async function adminPending(request,env){const authResponse=await app.fetch(request,env);if(!authResponse.ok)return authResponse;const [listings,businesses,recoveries]=await Promise.all([
 env.DB.prepare(`SELECT l.id,l.title,l.category,l.price,l.condition_text AS condition,l.city,l.description,l.image_url,l.created_at,u.name AS owner,u.phone AS owner_phone FROM listings l JOIN users u ON u.id=l.user_id WHERE l.status='pending' ORDER BY l.created_at`).all(),
 env.DB.prepare(`SELECT b.id,b.kind,b.name,b.category,b.city,b.address,b.hours,b.description,b.image_url,b.created_at,u.name AS owner,u.phone AS owner_phone FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.status='pending' ORDER BY b.created_at`).all(),
 env.DB.prepare(`SELECT rr.id,rr.created_at,u.name,u.phone FROM recovery_requests rr JOIN users u ON u.id=rr.user_id WHERE rr.status='pending' ORDER BY rr.created_at`).all()
]);return json({listings:listings.results,businesses:businesses.results,recoveries:recoveries.results})}

function locationInfo(request){const cf=request.cf||{};return json({city:cf.city||'',region:cf.region||cf.regionCode||'',country:cf.country||'',latitude:numberOrNull(cf.latitude,-90,90),longitude:numberOrNull(cf.longitude,-180,180)})}

async function staticResponse(request,env){let response=await app.fetch(request,env);const headers=new Headers(response.headers);headers.set('permissions-policy','camera=(), microphone=(), geolocation=(self)');response=new Response(response.body,{status:response.status,statusText:response.statusText,headers});const type=headers.get('content-type')||'';if(type.includes('text/html')){return new HTMLRewriter().on('head',{element(e){e.append('<link rel="stylesheet" href="/enhancements.css">',{html:true})}}).on('body',{element(e){e.append('<script src="/enhancements.js" defer></script>',{html:true})}}).transform(response)}return response}

export default{async fetch(request,env){const url=new URL(request.url),method=request.method;
  if(url.pathname==='/api/location'&&method==='GET')return locationInfo(request);
  if(url.pathname==='/api/catalog'&&method==='GET')return catalog(env,url);
  if(url.pathname==='/api/listings'&&method==='POST')return createListing(request,env);
  if(url.pathname==='/api/businesses'&&method==='POST')return createBusiness(request,env);
  if(url.pathname==='/api/favorites'&&method==='GET')return fullFavorites(request,env);
  if(url.pathname==='/api/me/listings'&&method==='GET')return myListings(request,env);
  if(url.pathname==='/api/me/businesses'&&method==='GET')return myBusinesses(request,env);
  if(url.pathname==='/api/me/delete'&&method==='POST')return archiveOwnItem(request,env);
  if(url.pathname==='/api/auth/update-profile'&&method==='POST')return updateProfile(request,env);
  if(url.pathname==='/api/admin/pending'&&method==='GET')return adminPending(request,env);

  if(url.pathname==='/api/auth/register'&&method==='POST'&&env.ADMIN_PHONE){try{const body=await request.clone().json();const requestedPhone=normalizePhone(body.phone),secretPhone=normalizePhone(env.ADMIN_PHONE);if(requestedPhone===secretPhone){const existingAdmin=await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();if(existingAdmin)return app.fetch(request,{...env,ADMIN_PHONE:''})}}catch{}}

  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return app.fetch(request,env);
  return staticResponse(request,env)
}};

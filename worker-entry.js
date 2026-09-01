import app from './worker.js';

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
}
function cleanText(v,max){return String(v??'').trim().replace(/[\u0000-\u001F\u007F]/g,' ').slice(0,max)}
function normalizePhone(v){let d=String(v??'').replace(/\D/g,'');if(d.length===10||d.length===11)d='55'+d;if(!/^55\d{10,11}$/.test(d))throw new Error('Informe um WhatsApp válido com DDD.');return d}
function b64ToBytes(v){const s=atob(v);return Uint8Array.from(s,c=>c.charCodeAt(0))}
function bytesToB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
async function hashPassword(password,saltB64){
  const salt=b64ToBytes(saltB64);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
  return bytesToB64(new Uint8Array(bits));
}
function timingSafe(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function getCurrentUser(request,env){
  const url=new URL(request.url);url.pathname='/api/auth/me';url.search='';
  const res=await app.fetch(new Request(url,{method:'GET',headers:request.headers}),env);
  if(!res.ok)return{response:res,user:null};
  const data=await res.json();
  if(!data.user)return{response:json({error:'Entre na sua conta para continuar.'},401),user:null};
  return{response:null,user:data.user};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Evita que o telefone antigo definido em ADMIN_PHONE crie uma segunda conta admin
    // caso o administrador já tenha alterado o número dentro do site.
    if(url.pathname==='/api/auth/register'&&request.method==='POST'&&env.ADMIN_PHONE){
      try{
        const body=await request.clone().json();
        const requestedPhone=normalizePhone(body.phone);
        const secretPhone=normalizePhone(env.ADMIN_PHONE);
        if(requestedPhone===secretPhone){
          const existingAdmin=await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
          if(existingAdmin){
            const safeEnv={...env,ADMIN_PHONE:''};
            return app.fetch(request,safeEnv);
          }
        }
      }catch{}
    }

    if(url.pathname==='/api/auth/update-profile'&&request.method==='POST'){
      try{
        const auth=await getCurrentUser(request,env);
        if(auth.response)return auth.response;
        const user=auth.user;
        const body=await request.json();
        const name=cleanText(body.name,100);
        const phone=normalizePhone(body.phone);
        const currentPassword=String(body.currentPassword??'');
        if(name.length<3)return json({error:'Informe seu nome completo.'},400);
        if(currentPassword.length<8||currentPassword.length>72)return json({error:'Informe sua senha atual.'},400);

        const row=await env.DB.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').bind(user.id).first();
        if(!row)return json({error:'Conta não encontrada.'},404);
        const hash=await hashPassword(currentPassword,row.password_salt);
        if(!timingSafe(hash,row.password_hash))return json({error:'A senha atual está incorreta.'},400);

        const duplicate=await env.DB.prepare('SELECT id FROM users WHERE phone=? AND id<>?').bind(phone,user.id).first();
        if(duplicate)return json({error:'Este WhatsApp já está cadastrado em outra conta.'},409);

        await env.DB.prepare('UPDATE users SET name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,phone,user.id).run();
        return json({user:{...user,name,phone}});
      }catch(error){
        return json({error:error?.message||'Não foi possível atualizar seus dados.'},400);
      }
    }

    if (url.pathname === '/api/admin/pending' && request.method === 'GET') {
      const authResponse = await app.fetch(request, env);
      if (!authResponse.ok) return authResponse;

      const [listings, businesses, recoveries] = await Promise.all([
        env.DB.prepare(`
          SELECT
            l.id,
            l.title,
            l.category,
            l.price,
            l.condition_text AS condition,
            l.city,
            l.description,
            l.image_url,
            l.created_at,
            u.name AS owner,
            u.phone AS owner_phone
          FROM listings l
          JOIN users u ON u.id = l.user_id
          WHERE l.status = 'pending'
          ORDER BY l.created_at
        `).all(),
        env.DB.prepare(`
          SELECT
            b.id,
            b.kind,
            b.name,
            b.category,
            b.city,
            b.address,
            b.hours,
            b.description,
            b.image_url,
            b.created_at,
            u.name AS owner,
            u.phone AS owner_phone
          FROM businesses b
          JOIN users u ON u.id = b.user_id
          WHERE b.status = 'pending'
          ORDER BY b.created_at
        `).all(),
        env.DB.prepare(`
          SELECT rr.id, rr.created_at, u.name, u.phone
          FROM recovery_requests rr
          JOIN users u ON u.id = rr.user_id
          WHERE rr.status = 'pending'
          ORDER BY rr.created_at
        `).all()
      ]);

      const headers = new Headers(authResponse.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('cache-control', 'no-store');

      return new Response(JSON.stringify({
        listings: listings.results,
        businesses: businesses.results,
        recoveries: recoveries.results
      }), { status: 200, headers });
    }

    return app.fetch(request, env);
  }
};

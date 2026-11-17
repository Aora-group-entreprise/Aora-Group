/**
 * AORA GROUP — public app catalogue + protected publishing API.
 * ADMIN_TOKEN and SUPABASE_SERVICE_ROLE_KEY are Cloudflare Worker secrets only.
 */
const BUCKET = "aoragroup";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set(["application/vnd.android.package-archive","application/octet-stream","image/jpeg","image/png","image/webp","image/svg+xml","application/pdf","application/zip","text/plain"]);
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const cors = (request, env) => {
  const origin=request.headers.get("Origin")||"", allowed=env.ALLOWED_ORIGIN||"*", ok=allowed==="*"||origin===allowed;
  return {"access-control-allow-origin":ok?(allowed==="*"?"*":origin):"null","access-control-allow-methods":"GET, HEAD, POST, PUT, DELETE, OPTIONS","access-control-allow-headers":"Authorization, Content-Type, Range","access-control-expose-headers":"Content-Length, Content-Range, Accept-Ranges, ETag","access-control-max-age":"86400","vary":"Origin","x-content-type-options":"nosniff"};
};
const base = env => {const u=String(env.SUPABASE_URL||"").replace(/\/+$/,"");if(!/^https:\/\/[A-Za-z0-9.-]+\.supabase\.co$/.test(u))throw Error("SUPABASE_URL missing or invalid");return u;};
const keyHeaders = env => {const k=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();if(!k)throw Error("Missing SUPABASE_SERVICE_ROLE_KEY");return {apikey:k,authorization:"Bearer "+k};};
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function sign(payload, secret){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(payload)));}
async function issueSession(env){const payload=b64(new TextEncoder().encode(JSON.stringify({exp:Date.now()+8*60*60*1000,scope:"admin"})));return payload+"."+await sign(payload,env.ADMIN_TOKEN);}
async function isAdmin(request,env){const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");const [payload,sig]=token.split(".");if(!payload||!sig||!env.ADMIN_TOKEN)return false;try{if(await sign(payload,env.ADMIN_TOKEN)!==sig)return false;const data=JSON.parse(new TextDecoder().decode(unb64(payload)));return data.scope==="admin"&&data.exp>Date.now();}catch{return false;}}
async function db(env,path,options={}){const res=await fetch(base(env)+"/rest/v1/"+path,{...options,headers:{...keyHeaders(env),"content-type":"application/json",...(options.headers||{})}});const text=await res.text();if(!res.ok)throw Error("Database request failed ("+res.status+"): "+text.slice(0,180));return text?JSON.parse(text):null;}
function cleanSlug(v){return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(v||""));}
function safePath(v){const s=String(v||"");return (s.startsWith("public/apps/")||s.startsWith("public/icons/"))&&s.length<500&&!s.includes("..")&&!s.includes("\\")&&/^[A-Za-z0-9._/-]+$/.test(s)?s:null;}
async function upload(request,env){
 if(!await isAdmin(request,env))return json({error:"Session administrateur invalide."},401);
 const u=new URL(request.url),slug=u.searchParams.get("slug"),name=u.searchParams.get("name")||"application.apk",kind=u.searchParams.get("kind")==="icon"?"icon":"app";
 if(!cleanSlug(slug))return json({error:"Identifiant d'application invalide."},400);
 const body=await request.arrayBuffer();if(!body.byteLength)return json({error:"Fichier vide."},400);
 if(body.byteLength>MAX_UPLOAD_BYTES)return json({error:"Limite de 50 Mo dépassée."},413);
 const type=(request.headers.get("Content-Type")||"application/octet-stream").split(";")[0].trim().toLowerCase();
 const ext=(name.match(/\.[A-Za-z0-9]{1,8}$/)||[".apk"])[0].toLowerCase();
 if(kind==="icon"){
  if(!["image/png","image/jpeg","image/webp"].includes(type)||![".png",".jpg",".jpeg",".webp"].includes(ext)||body.byteLength>5*1024*1024)return json({error:"Icône invalide. PNG, JPG ou WebP, 5 Mo maximum."},415);
 }else if(!ALLOWED.has(type)||![".apk",".zip",".pdf"].includes(ext))return json({error:"Format de fichier non autorisé."},415);
 if(kind==="screenshot"&&(!["image/png","image/jpeg","image/webp"].includes(type)||![".png",".jpg",".jpeg",".webp"].includes(ext)||body.byteLength>5*1024*1024))return json({error:"Capture invalide. PNG, JPG ou WebP, 5 Mo maximum."},415);const path=kind==="icon"?"public/icons/"+slug+"/icon"+ext:kind==="screenshot"?"public/screenshots/"+slug+"/"+crypto.randomUUID()+ext:"public/apps/"+slug+"/"+slug+ext;
 const encoded=path.split("/").map(encodeURIComponent).join("/");
 const res=await fetch(base(env)+"/storage/v1/object/"+BUCKET+"/"+encoded,{method:"POST",headers:{...keyHeaders(env),"content-type":type,"cache-control":"public, max-age=3600","x-upsert":"true"},body});
 if(!res.ok)throw Error("Storage upload failed ("+res.status+"): "+(await res.text()).slice(0,160));
 const publicUrl=base(env)+"/storage/v1/object/public/"+BUCKET+"/"+encoded;
 return json({success:true,storage_path:path,size:body.byteLength,download_url:publicUrl,icon_url:publicUrl,screenshot_url:publicUrl},201);
}
async function handle(request,env){const u=new URL(request.url),p=u.pathname;
 if(p==="/api/health"&&request.method==="GET"){const r=await fetch(base(env)+"/storage/v1/bucket/"+BUCKET,{headers:keyHeaders(env)});if(!r.ok)throw Error("Storage bucket check failed ("+r.status+")");return json({status:"connected",provider:"Supabase Storage",bucket:BUCKET});}
 if(p==="/api/admin/login"&&request.method==="POST"){const body=await request.json();if(!env.ADMIN_TOKEN||typeof body.password!=="string"||body.password!==env.ADMIN_TOKEN)return json({error:"Mot de passe incorrect."},401);return json({success:true,token:await issueSession(env),expiresIn:28800});}
 if(p==="/api/apps"&&request.method==="GET"){const rows=await db(env,"apps?select=id,slug,name,description,version,platform,category,storage_path,icon_url,file_size,screenshots,published_at&status=eq.published&order=published_at.desc");return json({apps:rows.map(a=>({...a,download_url:a.storage_path?base(env)+"/storage/v1/object/public/"+BUCKET+"/"+a.storage_path.split("/").map(encodeURIComponent).join("/"):null}))});}
 if(p==="/api/upload"&&request.method==="POST")return upload(request,env);
 if(p.startsWith("/api/admin/")){if(!await isAdmin(request,env))return json({error:"Accès administrateur requis."},401);
   if(p==="/api/admin/apps"&&request.method==="GET")return json({apps:await db(env,"apps?select=*&order=updated_at.desc")});
   if(p==="/api/admin/apps"&&request.method==="POST"){const a=await request.json();if(!cleanSlug(a.slug)||!String(a.name||"").trim())return json({error:"Nom et identifiant valides obligatoires."},400);const row={slug:a.slug,name:a.name,description:a.description||"",version:a.version||"1.0.0",platform:a.platform||"Android",category:a.category||"Application",status:a.status==="published"?"published":"draft",storage_path:safePath(a.storage_path),icon_url:a.icon_url||null,file_size:Number(a.file_size)||0,screenshots:Array.isArray(a.screenshots)?a.screenshots:[],published_at:a.status==="published"?new Date().toISOString():null,updated_at:new Date().toISOString()};const rows=await db(env,"apps",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});return json({app:rows[0]},201);}
   const match=p.match(/^\/api\/admin\/apps\/([0-9a-f-]{36})$/i);if(match&&request.method==="PUT"){const a=await request.json(),patch={name:a.name,description:a.description,version:a.version,platform:a.platform,category:a.category,status:a.status,storage_path:safePath(a.storage_path),icon_url:a.icon_url||null,file_size:Number(a.file_size)||0,screenshots:Array.isArray(a.screenshots)?a.screenshots:[],updated_at:new Date().toISOString(),published_at:a.status==="published"?new Date().toISOString():null};for(const k of Object.keys(patch))if(patch[k]===undefined)delete patch[k];const rows=await db(env,"apps?id=eq."+match[1],{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});return json({app:rows[0]||null});}
   if(match&&request.method==="DELETE"){await db(env,"apps?id=eq."+match[1],{method:"DELETE"});return json({success:true});}
 }
 return json({error:"Not found."},404);
}
export default {async fetch(request,env){const headers=cors(request,env);if(request.method==="OPTIONS")return new Response(null,{status:204,headers});try{const response=await handle(request,env);const h=new Headers(response.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);return new Response(response.body,{status:response.status,headers:h});}catch(e){console.error("AORA API:",e);return json({error:"Erreur du service AORA.",detail:new URL(request.url).searchParams.get("debug")==="1"?String(e.message):undefined},500,headers);}}};

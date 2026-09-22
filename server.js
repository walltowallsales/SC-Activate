const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SELLERCHAMP_API_TOKEN = process.env.SELLERCHAMP_API_TOKEN || process.env.SELLERCHAMP_TOKEN || '';
const APP_PIN = String(process.env.APP_PIN || '').trim();
const SC_BASE = 'https://app.sellerchamp.com';
const sessions = new Map();

app.use(express.json({limit:'1mb'}));

function makeSession() {
  const token=crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now()+30*24*60*60*1000);
  return token;
}
function sessionOK(req) {
  if (!APP_PIN) return true;
  const auth=String(req.headers.authorization||'');
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  const exp=sessions.get(token);
  if (!exp || exp < Date.now()) { if(token) sessions.delete(token); return false; }
  return true;
}
app.post('/api/login',(req,res)=>{
  if(!APP_PIN) return res.json({ok:true,pinRequired:false});
  if(String(req.body?.pin||'')!==APP_PIN) return res.status(401).json({error:'Incorrect PIN.'});
  res.json({ok:true,pinRequired:true,session:makeSession(),expiresDays:30});
});
app.use('/api',(req,res,next)=>{
  if(req.path==='/status') return next();
  if(!sessionOK(req)) return res.status(401).json({error:'PIN required.',pinRequired:true});
  next();
});

async function scFetch(endpoint, options={}) {
  if(!SELLERCHAMP_API_TOKEN) {
    const e=new Error('SELLERCHAMP_API_TOKEN is not configured on Render.'); e.status=500; throw e;
  }
  const headers={Accept:'application/json','Content-Type':'application/json',Token:SELLERCHAMP_API_TOKEN,...(options.headers||{})};
  const r=await fetch(SC_BASE+endpoint,{...options,headers});
  let data={}; const txt=await r.text();
  try { data=txt?JSON.parse(txt):{}; } catch { data={raw:txt}; }
  if(!r.ok){ const e=new Error(`SellerChamp returned ${r.status}`); e.status=r.status; e.data=data; throw e; }
  return data;
}
function rawProduct(data){ return data?.product || data || {}; }
function statusOf(p){ return String(p.marketplace_status ?? p.status ?? '').trim(); }
function activeStatus(s){ return String(s).toLowerCase()==='active'; }
function imageOf(p){
  const x=p.image_url||p.image||p.main_image_url||p.thumbnail_url||p.picture_url;
  if(typeof x==='string') return x;
  if(x?.url) return x.url;
  const arr=p.images||p.product_images||[];
  if(Array.isArray(arr)&&arr.length){ const a=arr[0]; return typeof a==='string'?a:(a.url||a.image_url||''); }
  return '';
}
function normalize(p){
  return {id:p.id,sku:p.sku||p.catalogue_sku||'',title:p.title||p.name||p.product_title||'',
    marketplace_status:statusOf(p),active:activeStatus(statusOf(p)),image:imageOf(p),
    quantity:Number(p.quantity_available ?? p.quantity ?? 0),
    location:p.location||p.item_location||''};
}
async function detail(id){
  const d=await scFetch(`/api/products/${encodeURIComponent(id)}.json`);
  return rawProduct(d);
}
async function findBySku(sku){
  const d=await scFetch(`/api/products.json?sku=${encodeURIComponent(sku)}&page=1&page_size=50`);
  let items=d.products||[];
  if(!Array.isArray(items)) items=items?[items]:[];
  const exact=items.filter(p=>String(p.sku||'').trim().toLowerCase()===sku.toLowerCase());
  const pool=exact.length?exact:items;
  if(!pool.length) return [];
  const out=[];
  for(const p of pool.slice(0,10)){
    try { out.push(normalize(await detail(p.id))); } catch { out.push(normalize(p)); }
  }
  return out;
}

app.get('/api/status',async(req,res)=>{
  const pinRequired=!!APP_PIN;
  try{
    await scFetch('/api/marketplace_accounts');
    res.json({ok:true,version:'1.3',pinRequired,authenticated:sessionOK(req),sellerchampConnected:true});
  }catch(e){
    res.status(e.status||500).json({ok:false,version:'1.3',pinRequired,authenticated:sessionOK(req),sellerchampConnected:false,error:'Could not connect to SellerChamp.',details:e.data||e.message});
  }
});
app.get('/api/lookup',async(req,res)=>{
  const sku=String(req.query.sku||'').trim();
  if(!sku) return res.status(400).json({error:'Enter an SKU.'});
  try{
    const products=await findBySku(sku);
    if(!products.length) return res.status(404).json({error:`No SellerChamp Product found for SKU ${sku}.`});
    res.json({products});
  }catch(e){res.status(e.status||500).json({error:'SellerChamp lookup failed.',details:e.data||e.message});}
});
app.put('/api/products/:id/activate',async(req,res)=>{
  const id=encodeURIComponent(req.params.id);
  const attempts=[];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  async function reread(){
    try { return normalize(await detail(req.params.id)); }
    catch(e){ return null; }
  }
  async function waitForActive(record){
    // SellerChamp/eBay relisting can be asynchronous. Once SellerChamp accepts a request,
    // do NOT send another relist format. Poll for up to 5 minutes instead.
    const started=Date.now();
    const pollEvery=10000;
    const maxWait=5*60*1000;
    record.polls=[];
    while(Date.now()-started <= maxWait){
      const p=await reread();
      const elapsed=Math.round((Date.now()-started)/1000);
      record.polls.push({elapsed_seconds:elapsed,status:p?.marketplace_status||null});
      record.after=p;
      if(p?.active){
        record.verifiedActive=true;
        record.activation_seconds=elapsed;
        return true;
      }
      if(Date.now()-started >= maxWait) break;
      await sleep(pollEvery);
    }
    record.verifiedActive=false;
    return false;
  }
  async function tryMethod(name, endpoint, body){
    const record={name,endpoint,body};
    try{
      const data=await scFetch(endpoint,{
        method:'PUT',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      record.http='2xx';
      record.accepted=true;
      record.response=data;
      attempts.push(record);
      // Critical V1.3 behavior: an accepted request gets the full wait window.
      // Never try another request format while an accepted relist may still be processing.
      await waitForActive(record);
      return {accepted:true,verified:record.verifiedActive};
    }catch(e){
      record.http=e.status||'error';
      record.accepted=false;
      record.response=e.data||e.message;
      record.after=await reread();
      attempts.push(record);
      return {accepted:false,verified:false};
    }
  }

  try{
    const beforeRaw=await detail(req.params.id);
    const before=normalize(beforeRaw);
    if(before.active) return res.json({ok:true,alreadyActive:true,product:before,attempts:[]});

    const safeProduct={};
    for(const k of ['sku','title','quantity_available','reserve_quantity','marketplace_status']){
      if(beforeRaw[k] !== undefined && beforeRaw[k] !== null) safeProduct[k]=beforeRaw[k];
    }

    const methods=[
      ['A — .json + relist=true + product payload',`/api/products/${id}.json?relist=true`,{product:safeProduct}],
      ['B — no .json + relist=true + product payload',`/api/products/${id}?relist=true`,{product:safeProduct}],
      ['C — .json + relist=true + top-level payload',`/api/products/${id}.json?relist=true`,safeProduct],
      ['D — no .json + relist=true + top-level payload',`/api/products/${id}?relist=true`,safeProduct],
      ['E — .json + relist=true + no request body',`/api/products/${id}.json?relist=true`,undefined],
      ['F — no .json + relist=true + no request body',`/api/products/${id}?relist=true`,undefined]
    ];

    for(const [name,endpoint,body] of methods){
      const result=await tryMethod(name,endpoint,body);
      if(result.accepted){
        const after=await reread();
        if(result.verified || after?.active){
          return res.json({ok:true,verified:true,product:after,attempts});
        }
        // Accepted but still inactive after 5 minutes: stop. Do NOT risk another relist request.
        return res.status(202).json({
          ok:false,
          pending:true,
          error:'SellerChamp accepted the relist request, but the listing has not reported ACTIVE within 5 minutes. No additional relist methods were sent.',
          product:after,
          attempts
        });
      }
      // Only an immediately rejected request moves to the next format.
    }

    const after=await reread();
    return res.status(409).json({
      error:'SellerChamp rejected every diagnostic relist request immediately.',
      product:after,
      attempts
    });
  }catch(e){
    res.status(e.status||500).json({error:'Activation diagnostics could not complete.',details:e.data||e.message,attempts});
  }
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Item - Activate Listing V1.3 running on ${PORT}`));

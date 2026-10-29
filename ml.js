// Tierrez AI - modulo Mercado Livre + busca/frete CJ. Carregado por server.js (require('./ml.js'))
const http=require('http'),fs=require('fs');
const E=process.env,API='https://api.mercadolibre.com',CJB='https://developers.cjdropshipping.com/api2.0/v1';
let M={};try{M=JSON.parse(fs.readFileSync('ml.json'))}catch{}
const sv=()=>{try{fs.writeFileSync('ml.json',JSON.stringify(M))}catch{}};
let CT=null;
async function cj(path,o={}){
  if(!CT||CT.e<Date.now()){const r=await(await fetch(CJB+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:E.CJ_API_KEY})})).json();
    if(!r.data)throw Error('CJ login falhou');CT={t:r.data.accessToken,e:Date.now()+14*864e5}}
  return(await fetch(CJB+path+'?'+new URLSearchParams(o.q||{}),{method:o.method||'GET',headers:{'Content-Type':'application/json','CJ-Access-Token':CT.t},body:o.body&&JSON.stringify(o.body)})).json()}
async function tok(b){
  const r=await(await fetch(API+'/oauth/token',{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:E.ML_APP_ID,client_secret:E.ML_SECRET,...b})})).json();
  if(!r.access_token)throw Error('ML: '+JSON.stringify(r));
  M={...M,t:r.access_token,rt:r.refresh_token,uid:r.user_id,exp:Date.now()+(r.expires_in-300)*1000};sv()}
async function ml(path,o={}){
  if(!M.t)throw Error('Mercado Livre nao conectado');
  if(M.exp<Date.now())await tok({grant_type:'refresh_token',refresh_token:M.rt});
  return(await fetch(API+path,{method:o.method||'GET',headers:{Authorization:'Bearer '+M.t,'Content-Type':'application/json'},body:o.body&&JSON.stringify(o.body)})).json()}const orig=http.createServer;
http.createServer=function(h){return orig.call(http,async(q,s)=>{
  const u=new URL(q.url,'http://x'),p=u.pathname,j=(c,o)=>{s.writeHead(c,{'Content-Type':'application/json'});s.end(JSON.stringify(o))};
  if(!/^\/(api\/(ml|cj2|freight2)|auth\/ml)/.test(p))return h(q,s);
  const body=()=>new Promise(r=>{let x='';q.on('data',c=>x+=c).on('end',()=>r(x?JSON.parse(x):{}))});
  try{
    if(p==='/auth/ml/callback'){await tok({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:E.PUBLIC_URL+'/auth/ml/callback'});s.writeHead(302,{Location:'/'});return s.end()}
    if((q.headers['x-key']||u.searchParams.get('k'))!==E.APP_KEY)return j(401,{error:'senha invalida'});
    if(p==='/auth/ml'){s.writeHead(302,{Location:'https://auth.mercadolivre.com.br/authorization?'+new URLSearchParams({response_type:'code',client_id:E.ML_APP_ID,redirect_uri:E.PUBLIC_URL+'/auth/ml/callback'})});return s.end()}
    if(p==='/api/ml/status')return j(200,{ml:!!M.t});
    if(p==='/api/ml/orders'){const r=await ml('/orders/search?seller='+M.uid+'&sort=date_desc');if(!r.results)return j(200,{error:JSON.stringify(r).slice(0,200)});
      return j(200,r.results.map(o=>({id:o.id,status:o.status,total:o.total_amount,items:(o.order_items||[]).map(i=>i.item.title+' x'+i.quantity).join(', ')})))}
    if(p==='/api/ml/questions'){const r=await ml('/questions/search?seller_id='+M.uid+'&status=UNANSWERED');if(!r.questions)return j(200,{error:JSON.stringify(r).slice(0,200)});
      return j(200,r.questions.map(x=>({id:x.id,name:'Pergunta',text:x.text})))}
    if(p==='/api/ml/answer'){const b=await body();return j(200,await ml('/answers',{method:'POST',body:{question_id:b.id,text:b.text}}))}
    if(p==='/api/ml/publish'){const b=await body();
      const d=await ml('/sites/MLB/domain_discovery/search?limit=1&q='+encodeURIComponent(b.title)),cat=d[0]?.category_id;if(!cat)return j(200,{error:'Categoria nao encontrada para esse titulo'});
      return j(200,await ml('/items',{method:'POST',body:{title:b.title,category_id:cat,price:+b.price,currency_id:'BRL',available_quantity:+b.qty,buying_mode:'buy_it_now',listing_type_id:'gold_special',condition:'new',pictures:[{source:b.img}]}}))}
    if(p==='/api/cj2'){const q2={pageNum:1,pageSize:20,productNameEn:u.searchParams.get('q')};if(u.searchParams.get('br')==='1')q2.countryCode='BR';const r=await cj('/product/list',{q:q2});return j(200,r.data?.list||r)}
    if(p==='/api/freight2'){const v=(await cj('/product/variant/query',{q:{pid:u.searchParams.get('pid')}})).data?.[0];if(!v)return j(200,{error:'Variante nao encontrada'});
      const r=await cj('/logistic/freightCalculate',{method:'POST',body:{startCountryCode:u.searchParams.get('br')==='1'?'BR':'CN',endCountryCode:'BR',products:[{quantity:1,vid:v.vid}]}});
      return j(200,{cost:v.variantSellPrice,opts:(r.data||[]).map(x=>({n:x.logisticName,p:x.logisticPrice,d:x.logisticAging}))})}
    j(404,{error:'nao encontrado'})
  }catch(e){j(500,{error:String(e.message)})}
})};

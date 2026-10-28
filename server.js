// Tierrez AI v2 - servidor real (Node 18+, sem dependencias): node server.js
// Variaveis: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ENV (sandbox|prod), PUBLIC_URL,
// APP_KEY (sua senha), CJ_API_KEY, SHOPEE_LOGISTICS (ex: [{"logistic_id":90017,"enabled":true}])
const http=require('http'),fs=require('fs'),crypto=require('crypto');
const E=process.env,PORT=E.PORT||3000,CJB='https://developers.cjdropshipping.com/api2.0/v1';
const SH=E.SHOPEE_ENV==='sandbox'?'https://partner.test-stable.shopeemobile.com':'https://partner.shopeemobile.com';
const PID=+E.SHOPEE_PARTNER_ID,PKEY=E.SHOPEE_PARTNER_KEY||'',KEY=E.APP_KEY;
let D={cjo:{},rep:[],shopee:null,cj:null,map:{},done:[],log:[],auto:false};
try{D={...D,...JSON.parse(fs.readFileSync('data.json'))}}catch{}
const save=()=>{try{fs.writeFileSync('data.json',JSON.stringify(D))}catch{}};
const log=(a,t)=>{D.log.unshift({a,t,h:new Date().toISOString()});D.log=D.log.slice(0,50);save()};
const sign=s=>crypto.createHmac('sha256',PKEY).update(s).digest('hex');
async function shopee(path,{method='GET',q={},body,shop=true,form}={}){
  if(shop){if(!D.shopee)throw Error('Shopee nao conectada');
    if(D.shopee.exp-300<Date.now()/1000){const t=Math.floor(Date.now()/1000);
      const r=await(await fetch(SH+'/api/v2/auth/access_token/get?'+new URLSearchParams({partner_id:PID,timestamp:t,sign:sign(PID+'/api/v2/auth/access_token/get'+t)}),
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:D.shopee.refresh_token,partner_id:PID,shop_id:D.shopee.shop_id})})).json();
      if(!r.access_token)throw Error('Falha ao renovar token: '+JSON.stringify(r));
      D.shopee={...D.shopee,access_token:r.access_token,refresh_token:r.refresh_token,exp:t+r.expire_in};save()}}
  const ts=Math.floor(Date.now()/1000),s=D.shopee;
  const p=new URLSearchParams({partner_id:PID,timestamp:ts,sign:sign(PID+path+ts+(shop?s.access_token+s.shop_id:'')),...(shop?{access_token:s.access_token,shop_id:s.shop_id}:{}),...q});
  const r=await fetch(SH+path+'?'+p,{method,headers:form?{}:{'Content-Type':'application/json'},body:form||(body&&JSON.stringify(body))});
  return r.json()}
async function cj(path,{method='GET',q={},body}={}){
  if(!D.cj||D.cj.exp<Date.now()){const r=await(await fetch(CJB+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:E.CJ_API_KEY})})).json();
    if(!r.data)throw Error('CJ login falhou: '+JSON.stringify(r));D.cj={t:r.data.accessToken,exp:Date.now()+14*864e5};save()}
  return(await fetch(CJB+path+'?'+new URLSearchParams(q),{method,headers:{'Content-Type':'application/json','CJ-Access-Token':D.cj.t},body:body&&JSON.stringify(body)})).json()}async function orders(){const n=Math.floor(Date.now()/1000);
  const l=await shopee('/api/v2/order/get_order_list',{q:{time_range_field:'create_time',time_from:n-864e3,time_to:n,page_size:50}});
  const sn=(l.response?.order_list||[]).map(o=>o.order_sn);if(!sn.length)return[];
  const d=await shopee('/api/v2/order/get_order_detail',{q:{order_sn_list:sn.join(','),response_optional_fields:'recipient_address,item_list,total_amount'}});
  return d.response?.order_list||[]}
async function buy(o){const prods=[];
  for(const i of o.item_list){const v=D.map[i.item_id];if(!v)return log('Vendas','Pedido '+o.order_sn+': item sem vinculo CJ, compre manualmente');prods.push({vid:v,quantity:i.model_quantity_purchased})}
  const a=o.recipient_address||{};
  const r=await cj('/shopping/order/createOrderV2',{method:'POST',body:{orderNumber:o.order_sn,shippingCountryCode:'BR',shippingCountry:'Brazil',shippingProvince:a.state,shippingCity:a.city,shippingAddress:a.full_address,shippingZip:a.zipcode,shippingCustomerName:a.name,shippingPhone:a.phone,fromCountryCode:'CN',logisticName:'CJPacket Ordinary',products:prods}});
  if(r.data?.orderId)D.cjo[o.order_sn]=r.data.orderId;log('Vendas','Pedido '+o.order_sn+' enviado ao CJ: '+(r.message||r.result))}
async function tick(){if(!D.auto||!D.shopee)return;
  for(const o of await orders())if(o.order_status==='READY_TO_SHIP'&&!D.done.includes(o.order_sn)){D.done.push(o.order_sn);await buy(o)}save()}
setInterval(()=>tick().then(talk).catch(e=>log('Erro',String(e))),3e5);
async function publish(b){
  const v=(await cj('/product/variant/query',{q:{pid:b.pid}})).data?.[0];if(!v)throw Error('Variante CJ nao encontrada');
  const img=await(await fetch(b.img)).arrayBuffer(),f=new FormData();f.append('image',new Blob([img]),'p.jpg');
  const up=await shopee('/api/v2/media_space/upload_image',{method:'POST',shop:false,form:f});
  const id=up.response?.image_info?.image_id;if(!id)throw Error('Upload de imagem falhou: '+JSON.stringify(up));
  const r=await shopee('/api/v2/product/add_item',{method:'POST',body:{item_name:b.name,description:b.desc||b.name,original_price:+b.price,normal_stock:+b.stock,weight:+b.weight||0.3,category_id:+b.cat,image:{image_id_list:[id]},logistic_info:JSON.parse(E.SHOPEE_LOGISTICS||'[]'),item_status:'NORMAL'}});
  const iid=r.response?.item_id;if(iid){D.map[iid]=v.vid;save();log('Cadastrador','Publicou '+b.name+' (item '+iid+')')}return r}const ans=t=>{t=(t||'').toLowerCase();if(/prazo|chega|entrega|rastre/.test(t))return'Ola! O prazo e de 7 a 15 dias uteis. Assim que o pedido for enviado, o rastreio aparece no app da Shopee.';if(/defeito|troca|devol/.test(t))return'Sentimos muito! Envie uma foto do produto e resolvemos a troca sem custo.';if(/desconto|cupom/.test(t))return'Ola! Fale com a gente que preparamos um desconto para voce.';return'Ola! Obrigado pelo contato. Ja estamos verificando e retornamos em instantes.'};
const chats=async()=>(await shopee('/api/v2/sellerchat/get_conversation_list',{q:{direction:'latest',type:'all',page_size:20}})).response?.conversations||[];
const say=(to,text)=>shopee('/api/v2/sellerchat/send_message',{method:'POST',body:{to_id:+to,message_type:'text',content:{text}}});
async function talk(){if(!D.auto||!D.shopee)return;for(const c of await chats()){const k=c.conversation_id+':'+c.latest_message_id;
  if(c.unread_count>0&&!D.rep.includes(k)){D.rep.push(k);await say(c.to_id,ans(c.latest_message_content?.text));log('Atendimento','Respondeu '+(c.to_name||'cliente'))}}D.rep=D.rep.slice(-200);save()}
async function ship(sn){const p=await shopee('/api/v2/logistics/get_shipping_parameter',{q:{order_sn:sn}}),i=p.response?.info_needed||{},b={order_sn:sn};
  if(i.dropoff)b.dropoff={};else if(i.pickup){const a=p.response.pickup?.address_list?.[0];b.pickup={address_id:a?.address_id,pickup_time_id:a?.time_slot_list?.[0]?.pickup_time_id}}else b.non_integrated={};
  const r=await shopee('/api/v2/logistics/ship_order',{method:'POST',body:b}),t=await shopee('/api/v2/logistics/get_tracking_number',{q:{order_sn:sn}});
  log('Entregas','Envio organizado '+sn+': '+(t.response?.tracking_number||r.message||'ok'));return{ship:r,tracking:t.response?.tracking_number}}
const body=q=>new Promise(r=>{let s='';q.on('data',c=>s+=c).on('end',()=>r(s?JSON.parse(s):{}))});
http.createServer(async(q,s)=>{const u=new URL(q.url,'http://x'),j=(c,o)=>{s.writeHead(c,{'Content-Type':'application/json'});s.end(JSON.stringify(o))};
  try{
    if(u.pathname==='/'){s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return s.end(fs.readFileSync(__dirname+'/app.html'))}
    if(u.pathname==='/auth/callback'){const t=Math.floor(Date.now()/1000),sh=+u.searchParams.get('shop_id');
      const r=await(await fetch(SH+'/api/v2/auth/token/get?'+new URLSearchParams({partner_id:PID,timestamp:t,sign:sign(PID+'/api/v2/auth/token/get'+t)}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:u.searchParams.get('code'),shop_id:sh,partner_id:PID})})).json();
      if(!r.access_token){s.writeHead(400);return s.end(JSON.stringify(r))}
      D.shopee={shop_id:sh,access_token:r.access_token,refresh_token:r.refresh_token,exp:t+r.expire_in};log('Conexao','Loja Shopee '+sh+' conectada');s.writeHead(302,{Location:'/'});return s.end()}
    if((q.headers['x-key']||u.searchParams.get('k'))!==KEY)return j(401,{error:'senha invalida'});
    if(u.pathname==='/auth/shopee'){const t=Math.floor(Date.now()/1000);s.writeHead(302,{Location:SH+'/api/v2/shop/auth_partner?'+new URLSearchParams({partner_id:PID,timestamp:t,sign:sign(PID+'/api/v2/shop/auth_partner'+t),redirect:E.PUBLIC_URL+'/auth/callback'})});return s.end()}
    if(u.pathname==='/api/status')return j(200,{shopee:!!D.shopee,cj:!!E.CJ_API_KEY,auto:D.auto,log:D.log});
    if(u.pathname==='/api/orders')return j(200,await orders());
    if(u.pathname==='/api/buy'){const o=(await orders()).find(x=>x.order_sn===u.searchParams.get('sn'));await buy(o);return j(200,{ok:1})}
    if(u.pathname==='/api/cj'){const r=await cj('/product/list',{q:{pageNum:1,pageSize:20,productNameEn:u.searchParams.get('q')}});return j(200,r.data?.list||r)}
    if(u.pathname==='/api/publish')return j(200,await publish(await body(q)));
    if(u.pathname==='/api/auto'){D.auto=!D.auto;save();return j(200,{auto:D.auto})}
    if(u.pathname==='/api/chats')return j(200,(await chats()).map(c=>({to:c.to_id,name:c.to_name||'Cliente',text:c.latest_message_content?.text||'(midia)',unread:c.unread_count})));
    if(u.pathname==='/api/say'){const b=await body(q);return j(200,await say(b.to,b.text))}
    if(u.pathname==='/api/ship')return j(200,await ship(u.searchParams.get('sn')));
    if(u.pathname==='/api/track'){const id=D.cjo[u.searchParams.get('sn')];if(!id)return j(200,{track:null});const r=await cj('/shopping/order/getOrderDetail',{q:{orderId:id}});return j(200,{track:r.data?.trackNumber})}
    j(404,{error:'nao encontrado'})}catch(e){log('Erro',String(e.message));j(500,{error:String(e.message)})}
}).listen(PORT,()=>console.log('Tierrez AI v2 na porta '+PORT));

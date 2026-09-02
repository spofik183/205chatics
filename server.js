const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 80 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '205chating-change-this-secret-in-production';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PURCHASE_PACKAGES = [
  { id:'s100', berries:100, rub:49 },
  { id:'s300', berries:300, rub:119 },
  { id:'s750', berries:750, rub:239 }
];
const PAYMENT_PHONE = '+79811292091';
const APP_VERSION = '0.1.8v';
const IS_PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
  next();
});

function makeRateLimiter({windowMs=60000,max=60}={}){
  const buckets=new Map();
  return (req,res,next)=>{
    const now=Date.now(); const key=req.ip||req.socket.remoteAddress||'unknown';
    let b=buckets.get(key); if(!b||now-b.start>=windowMs)b={start:now,count:0};
    b.count++; buckets.set(key,b);
    if(b.count>max)return res.status(429).json({error:'Слишком много запросов. Попробуйте чуть позже.'});
    if(buckets.size>5000)for(const [k,v] of buckets)if(now-v.start>=windowMs)buckets.delete(k);
    next();
  };
}
const authRateLimit=makeRateLimiter({windowMs:60000,max:20});
const writeRateLimit=makeRateLimiter({windowMs:60000,max:180});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultDb(){
  return {
    users: [], messages: [], gifts: [], purchases: [], supportThreads: {},
    giftCatalog: [], referrals: [], premiumRequests: [], channels: [], stocks: [], stockHoldings: {}, stockTrades: [], maintenanceUntil: null,
    channel: { name:'205chat', avatarUrl:'', description:'Общий чат 205chating', verified:true }
  };
}
function loadDb(){
  try{
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    parsed.users ||= []; parsed.messages ||= []; parsed.gifts ||= []; parsed.purchases ||= []; parsed.supportThreads ||= {};
    parsed.giftCatalog ||= [];
    parsed.referrals ||= [];
    parsed.premiumRequests ||= [];
    parsed.channels ||= [];
    parsed.stocks ||= [];
    parsed.stockHoldings ||= {};
    parsed.stockTrades ||= [];
    parsed.referrals = parsed.referrals.map(r=>({id:r.id||crypto.randomUUID(),code:String(r.code||'').trim(),berries:Math.max(1,Math.trunc(Number(r.berries)||1)),createdAt:r.createdAt||new Date().toISOString(),createdBy:r.createdBy||null,claimedUserIds:Array.isArray(r.claimedUserIds)?r.claimedUserIds:[]})).filter(r=>r.code);
    parsed.premiumRequests = parsed.premiumRequests.map(p=>({id:p.id||crypto.randomUUID(),userId:p.userId,months:[1,3,6].includes(Number(p.months))?Number(p.months):1,rub:Number(p.rub)||139,status:p.status||'pending',createdAt:p.createdAt||new Date().toISOString(),updatedAt:p.updatedAt||p.createdAt||new Date().toISOString()})).filter(p=>p.userId);
    // 0.1.8v: пользовательские каналы полностью удалены. Старые записи очищаются при миграции.
    parsed.channels = [];
    parsed.messages = parsed.messages.filter(m=>(m.chatType||'global')!=='channel');
    parsed.stocks = parsed.stocks.map(st=>({
      id:st.id||crypto.randomUUID(), name:String(st.name||'Акция').trim().slice(0,40), avatarUrl:st.avatarUrl||'', creatorId:st.creatorId||null,
      verified:!!st.verified, circulating:Math.max(0,Math.trunc(Number(st.circulating)||0)), createdAt:st.createdAt||new Date().toISOString(),
      priceHistory:Array.isArray(st.priceHistory)&&st.priceHistory.length?st.priceHistory.map(x=>({at:x.at||new Date().toISOString(),price:Math.max(.01,Number(x.price)||.01)})).slice(-240):[{at:new Date().toISOString(),price:.01}]
    })).filter(st=>st.creatorId&&st.name);
    if(!parsed.stockHoldings || typeof parsed.stockHoldings!=='object' || Array.isArray(parsed.stockHoldings))parsed.stockHoldings={};
    parsed.stockTrades = (Array.isArray(parsed.stockTrades)?parsed.stockTrades:[]).slice(-5000);
    parsed.maintenanceUntil ||= null;
    // v10: базовых подарков больше нет. Рынок полностью создаёт администратор.
    parsed.giftCatalog = parsed.giftCatalog.filter(g=>!g.seed).map(g=>({id:g.id||crypto.randomUUID(),key:g.key||g.id||crypto.randomUUID(),name:String(g.name||'Подарок'),price:Math.max(1,Math.trunc(Number(g.price)||1)),image:g.image||'',type:g.type==='nft'?'nft':'gift',totalSupply:Math.max(1,Math.trunc(Number(g.totalSupply)||1)),remaining:Math.max(0,Math.trunc(Number(g.remaining ?? g.totalSupply)||0)),createdAt:g.createdAt||new Date().toISOString(),releaseAt:g.releaseAt||null,createdBy:g.createdBy||null}));
    parsed.channel ||= {name:'205chat',avatarUrl:'',description:'Общий чат 205chating',verified:true};
    parsed.channel.name='205chat'; parsed.channel.verified=true; parsed.channel.avatarUrl ||= ''; parsed.channel.description ||= 'Общий чат 205chating';
    for(const u of parsed.users){
      u.contacts ||= []; u.blocked ||= []; u.avatarUrl ||= ''; u.bio ||= ''; u.hidePhone = !!u.hidePhone; u.online = false; u.strawberries = Math.max(0,Number(u.strawberries)||0); u.featuredGiftId ||= null; u.premiumUntil ||= null; u.stockWalletOpened=!!u.stockWalletOpened;
    }
    for(const m of parsed.messages){
      m.chatType ||= 'global'; m.recipientId ||= null; m.channelId ||= null; m.viewers ||= []; m.reactions ||= {}; m.hiddenFor ||= []; m.replyTo ||= null; m.pinned = !!m.pinned; m.giftId ||= null; m.poll ||= null;
    }
    for(const [uid,thread] of Object.entries(parsed.supportThreads)){
      thread.userId ||= uid; thread.visible = thread.visible !== false; thread.messages ||= []; thread.createdAt ||= new Date().toISOString();
    }
    return parsed;
  }catch{return defaultDb()}
}
let db = loadDb();
function saveDb(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const tmp=DATA_FILE+'.tmp'; const bak=DATA_FILE+'.bak';
  try{
    fs.writeFileSync(tmp,JSON.stringify(db,null,2));
    if(fs.existsSync(DATA_FILE))try{fs.copyFileSync(DATA_FILE,bak)}catch{}
    fs.renameSync(tmp,DATA_FILE);
  }catch(err){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{};console.error('[db] save failed',err);throw err}
}

const ADMIN_PHONE = '+77777777777';
const ADMIN_USERNAME = 'админ67';
const ADMIN_PASSWORD = '220419';
const normalizePhone = phone => String(phone||'').replace(/[^\d+]/g,'');
const normalizeUsername = username => String(username||'').trim().replace(/^@/,'');
const isRootAdmin = u => u?.phone === ADMIN_PHONE;
const giftDef = key => db.giftCatalog.find(g=>g.key===key||g.id===key) || null;
const giftRecord = id => db.gifts.find(g=>g.id===id) || null;
const isPremium = u => !!u && !!u.premiumUntil && new Date(u.premiumUntil).getTime() > Date.now();
const premiumPlan = months => ({1:139,3:319,6:509}[Number(months)]||null);
const channelFor = id => db.channels.find(c=>c.id===id)||null;
function canAccessChannel(c,u){return !!c&&(c.isPublic||c.ownerId===u.id||(c.members||[]).includes(u.id));}
const STOCK_BASE_PRICE = 0.01;
const STOCK_GROWTH = 1.004;
const STOCK_SELL_FACTOR = 0.98;
const STOCK_MAX_CREATED = 3;
const roundBerry = n => Math.max(0,Math.round((Number(n)||0)*10000)/10000);
const stockFor = id => db.stocks.find(s=>s.id===id)||null;
function stockPrice(stock){return Math.max(STOCK_BASE_PRICE,Math.round(STOCK_BASE_PRICE*Math.pow(STOCK_GROWTH,Math.max(0,Number(stock?.circulating)||0))*10000)/10000)}
function stockCurveCost(start,qty){start=Math.max(0,Math.trunc(Number(start)||0));qty=Math.max(0,Math.trunc(Number(qty)||0));if(!qty)return 0;const raw=STOCK_BASE_PRICE*Math.pow(STOCK_GROWTH,start)*(Math.pow(STOCK_GROWTH,qty)-1)/(STOCK_GROWTH-1);return roundBerry(raw)}
function stockHolding(userId,stockId){return Math.max(0,Math.trunc(Number(db.stockHoldings?.[userId]?.[stockId])||0))}
function setStockHolding(userId,stockId,qty){db.stockHoldings[userId] ||= {};qty=Math.max(0,Math.trunc(Number(qty)||0));if(qty)db.stockHoldings[userId][stockId]=qty;else delete db.stockHoldings[userId][stockId]}
function recordStockPoint(stock){stock.priceHistory ||= [];const price=stockPrice(stock);const last=stock.priceHistory[stock.priceHistory.length-1];if(!last||last.price!==price||Date.now()-new Date(last.at).getTime()>300000)stock.priceHistory.push({at:new Date().toISOString(),price});stock.priceHistory=stock.priceHistory.slice(-240)}
function stockHourStats(stock){const now=Date.now(),cut=now-3600000,history=stock.priceHistory||[];const current=stockPrice(stock);let anchor=history[0]?.price||STOCK_BASE_PRICE;for(const p of history){const t=new Date(p.at).getTime();if(t<=cut)anchor=p.price;else break}anchor=Math.max(STOCK_BASE_PRICE,Number(anchor)||STOCK_BASE_PRICE);const growth=Math.round(((current-anchor)/anchor)*10000)/100;const volume=db.stockTrades.filter(t=>t.stockId===stock.id&&new Date(t.createdAt).getTime()>=cut).reduce((a,t)=>a+Math.abs(Number(t.qty)||0),0);let forecast='Стабильно';if(growth>=8)forecast='Сильный рост';else if(growth>=2)forecast='Растёт';else if(growth<=-8)forecast='Сильный откат';else if(growth<=-2)forecast='Снижается';else if(volume>=100)forecast='Высокая активность';return {growth1h:growth,volume1h:volume,forecast}}
function deleteStockWithRefund(stock){if(!stock)return 0;const price=stockPrice(stock);let refunded=0;for(const [uid,portfolio] of Object.entries(db.stockHoldings||{})){const qty=Math.max(0,Math.trunc(Number(portfolio?.[stock.id])||0));if(!qty)continue;const u=db.users.find(x=>x.id===uid);if(u){const amount=roundBerry(price*qty);u.strawberries=roundBerry((Number(u.strawberries)||0)+amount);refunded=roundBerry(refunded+amount)}delete portfolio[stock.id]}db.stocks=db.stocks.filter(x=>x.id!==stock.id);db.stockTrades=db.stockTrades.filter(t=>t.stockId!==stock.id);return refunded}
function removeUserStockHoldings(userId){const portfolio=db.stockHoldings?.[userId]||{};for(const [stockId,qtyRaw] of Object.entries(portfolio)){const stock=stockFor(stockId),qty=Math.max(0,Math.trunc(Number(qtyRaw)||0));if(stock&&qty){stock.circulating=Math.max(0,(Number(stock.circulating)||0)-qty);recordStockPoint(stock)}}delete db.stockHoldings[userId]}
function giftSummary(id){
  const r=giftRecord(id); if(!r)return null; const def=giftDef(r.giftKey); if(!def)return null;
  return {id:r.id,giftKey:r.giftKey,name:def.name,image:def.image,price:r.price,type:def.type||'gift',serial:r.serial||null,totalSupply:def.totalSupply||null};
}
function cleanUser(u,viewer=null){
  const canSeePhone = !u.hidePhone || viewer?.id===u.id || viewer?.isAdmin;
  return {id:u.id,phone:canSeePhone?u.phone:'',phoneHidden:!!u.hidePhone,username:u.username,avatarUrl:u.avatarUrl||'',bio:u.bio||'',isAdmin:!!u.isAdmin,verified:!!u.verified,online:!!u.online,createdAt:u.createdAt,strawberries:roundBerry(u.strawberries),featuredGift:giftSummary(u.featuredGiftId),blockedByMe:!!viewer?.blocked?.includes?.(u.id),premium:isPremium(u),premiumUntil:u.premiumUntil||null,stockWalletOpened:!!u.stockWalletOpened};
}
function adminUser(u){ return {...cleanUser(u,{isAdmin:true}),rootAdmin:isRootAdmin(u)}; }
function stockSummary(stock,viewer,{history=false}={}){
  const creator=db.users.find(u=>u.id===stock.creatorId);const stats=stockHourStats(stock);const result={
    id:stock.id,name:stock.name,avatarUrl:stock.avatarUrl||'',verified:!!stock.verified,creator:creator?cleanUser(creator,viewer):{id:null,username:'Удалён'},
    creatorId:stock.creatorId,createdAt:stock.createdAt,circulating:Math.max(0,Math.trunc(Number(stock.circulating)||0)),price:stockPrice(stock),
    growth1h:stats.growth1h,volume1h:stats.volume1h,forecast:stats.forecast,owned:viewer?stockHolding(viewer.id,stock.id):0,mine:!!viewer&&stock.creatorId===viewer.id
  };
  if(history)result.history=(stock.priceHistory||[]).slice(-120);
  return result;
}

async function ensureAdmin(){
  let admin=db.users.find(u=>u.phone===ADMIN_PHONE||u.username===ADMIN_USERNAME);
  if(!admin){
    admin={id:crypto.randomUUID(),phone:ADMIN_PHONE,username:ADMIN_USERNAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,10),avatarUrl:'',bio:'',isAdmin:true,verified:true,online:false,contacts:[],blocked:[],strawberries:0,featuredGiftId:null,premiumUntil:null,stockWalletOpened:false,createdAt:new Date().toISOString()};
    db.users.push(admin);
  }else{
    admin.phone=ADMIN_PHONE; admin.username=ADMIN_USERNAME; admin.isAdmin=true; admin.verified=true; admin.contacts||=[]; admin.blocked||=[]; admin.avatarUrl||=''; admin.bio||=''; admin.strawberries=Math.max(0,Number(admin.strawberries)||0); admin.stockWalletOpened=!!admin.stockWalletOpened;
    if(!admin.passwordHash)admin.passwordHash=await bcrypt.hash(ADMIN_PASSWORD,10);
  }
  saveDb();
}

const tokenFor = u => jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});
function auth(req,res,next){
  try{
    const raw=req.headers.authorization||'';
    const p=jwt.verify(raw.startsWith('Bearer ')?raw.slice(7):'',JWT_SECRET);
    const u=db.users.find(x=>x.id===p.id);
    if(!u)return res.status(401).json({error:'Сессия недействительна'});
    req.user=u; next();
  }catch{return res.status(401).json({error:'Нужно войти'})}
}
const adminOnly=(req,res,next)=>req.user?.isAdmin?next():res.status(403).json({error:'Только для администратора'});

const storage=multer.diskStorage({
  destination:(_r,_f,cb)=>cb(null,UPLOAD_DIR),
  filename:(_r,f,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(f.originalname||'').toLowerCase().slice(0,8)}`)
});
const upload=multer({
  storage,
  limits:{fileSize:80*1024*1024,files:1},
  fileFilter:(_req,file,cb)=>{
    const mime=String(file.mimetype||'').toLowerCase();
    const ext=path.extname(file.originalname||'').toLowerCase();
    const known=['.jpg','.jpeg','.png','.webp','.gif','.avif','.webm','.mp4','.mov','.m4v','.ogg','.opus','.m4a','.mp3','.wav','.pdf','.txt','.zip','.doc','.docx'];
    if(mime.startsWith('image/')||mime.startsWith('video/')||mime.startsWith('audio/')||mime==='application/octet-stream'||known.includes(ext))return cb(null,true);
    cb(new Error('Недопустимый тип файла'));
  }
});

app.get('/health',(_req,res)=>res.status(200).json({ok:true,version:APP_VERSION,users:db.users.length}));
app.get('/api/version',(_req,res)=>res.json({version:APP_VERSION,beta:true}));

app.post('/api/register',authRateLimit,async(req,res)=>{
  const phone=normalizePhone(req.body.phone), username=normalizeUsername(req.body.username), password=String(req.body.password||'');
  if(req.body.acceptedTerms!==true)return res.status(400).json({error:'Нужно принять пользовательское соглашение'});
  if(!/^\+7\d{10}$/.test(phone))return res.status(400).json({error:'Введите номер в формате +7XXXXXXXXXX'});
  if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа, буквы, цифры или _'});
  if(password.length<6)return res.status(400).json({error:'Пароль минимум 6 символов'});
  if(db.users.some(u=>u.phone===phone))return res.status(409).json({error:'Этот номер уже зарегистрирован'});
  if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Этот username уже занят'});
  const u={id:crypto.randomUUID(),phone,username,passwordHash:await bcrypt.hash(password,10),avatarUrl:'',bio:'',isAdmin:false,verified:false,online:false,contacts:[],blocked:[],strawberries:0,featuredGiftId:null,premiumUntil:null,stockWalletOpened:false,createdAt:new Date().toISOString()};
  db.users.push(u); saveDb(); io.emit('participants',db.users.length); res.json({token:tokenFor(u),user:cleanUser(u,u)});
});
app.post('/api/login',authRateLimit,async(req,res)=>{
  const login=String(req.body.login||'').trim(), password=String(req.body.password||'');
  const phone=normalizePhone(login), user=normalizeUsername(login).toLowerCase();
  const u=db.users.find(x=>x.phone===phone||x.username.toLowerCase()===user);
  if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:'Неверный логин или пароль'});
  res.json({token:tokenFor(u),user:cleanUser(u,u)});
});

app.get('/api/me',auth,(req,res)=>res.json({user:cleanUser(req.user,req.user)}));
app.patch('/api/profile',auth,(req,res)=>{
  const username=normalizeUsername(req.body.username);
  if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа, буквы, цифры или _'});
  if(db.users.some(u=>u.id!==req.user.id&&u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Этот username уже занят'});
  req.user.username=username;
  if(Object.prototype.hasOwnProperty.call(req.body,'bio')) req.user.bio=String(req.body.bio||'').trim().slice(0,200);
  if(Object.prototype.hasOwnProperty.call(req.body,'hidePhone')) req.user.hidePhone=!!req.body.hidePhone;
  saveDb(); const user=cleanUser(req.user); io.emit('user-updated',user); res.json({user});
});
app.post('/api/profile/avatar',auth,upload.single('avatar'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Выберите изображение'});
  if(!req.file.mimetype.startsWith('image/')){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Для аватара нужно изображение'})}
  req.user.avatarUrl=`/uploads/${req.file.filename}`; saveDb(); const user=cleanUser(req.user); io.emit('user-updated',user); res.json({user});
});
app.get('/api/users/:id',auth,(req,res)=>{
  const u=db.users.find(x=>x.id===req.params.id); if(!u)return res.status(404).json({error:'Пользователь не найден'});
  const gifts=db.gifts.filter(g=>g.receiverId===u.id).slice(-24).reverse().map(g=>({...giftSummary(g.id),letter:g.letter||'',createdAt:g.createdAt,sender:cleanUser(db.users.find(x=>x.id===g.senderId)||{id:null,username:'Пользователь',phone:''})}));
  res.json({user:cleanUser(u,req.user),gifts});
});

app.get('/api/channel',auth,(req,res)=>res.json({channel:db.channel}));
app.patch('/api/channel',auth,adminOnly,(req,res)=>{
  if(Object.prototype.hasOwnProperty.call(req.body,'description')) db.channel.description=String(req.body.description||'').trim().slice(0,500);
  saveDb(); io.emit('channel-updated',db.channel); res.json({channel:db.channel});
});
app.post('/api/channel/avatar',auth,adminOnly,upload.single('avatar'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Выберите изображение'});
  const imageExt=path.extname(req.file.originalname||'').toLowerCase(); const looksImage=req.file.mimetype.startsWith('image/')||(['.jpg','.jpeg','.png','.webp','.gif','.avif'].includes(imageExt)); if(!looksImage){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Нужно изображение JPG, PNG, WEBP, GIF или AVIF'})}
  db.channel.avatarUrl=`/uploads/${req.file.filename}`; saveDb(); io.emit('channel-updated',db.channel); res.json({channel:db.channel});
});
app.delete('/api/channel/messages',auth,adminOnly,(req,res)=>{
  db.messages=db.messages.filter(m=>(m.chatType||'global')==='private'); saveDb(); io.emit('global-chat-cleared'); res.json({ok:true});
});

app.post('/api/upload',auth,writeRateLimit,upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Файл не выбран'});
  let mime=req.file.mimetype||'';
  const ext=path.extname(req.file.originalname||req.file.filename||'').toLowerCase();
  // Некоторые мобильные браузеры отправляют запись MediaRecorder как octet-stream.
  if(!mime||mime==='application/octet-stream'){
    if(['.webm','.mp4','.mov','.m4v'].includes(ext)) mime='video/'+(ext==='.webm'?'webm':'mp4');
    else if(['.ogg','.opus','.webm','.m4a','.mp3','.wav'].includes(ext)) mime=ext==='.webm'?'audio/webm':`audio/${ext.slice(1)}`;
  }
  let type=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'file';
  // Для записей MediaRecorder клиент явно передаёт kind: это надёжнее MIME на Safari/Android WebView.
  const forcedKind=String(req.body?.kind||'').toLowerCase();
  if(['image','video','audio'].includes(forcedKind)) type=forcedKind;
  const original=String(req.file.originalname||'').toLowerCase();
  if(original.startsWith('square-')||original.startsWith('triangle-')) type='video';
  if(original.startsWith('voice-')) type='audio';
  if(type==='video'&&!mime.startsWith('video/')) mime=ext==='.mp4'||ext==='.mov'||ext==='.m4v'?'video/mp4':'video/webm';
  if(type==='audio'&&!mime.startsWith('audio/')) mime=ext==='.mp4'||ext==='.m4a'?'audio/mp4':'audio/webm';
  if(type==='file'&&!['.pdf','.txt','.zip','.doc','.docx'].includes(ext)){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Этот тип файла не поддерживается'})}
  res.json({url:`/uploads/${req.file.filename}`,type,mime,name:String(req.file.originalname||'').slice(0,120),size:req.file.size});
});
app.get('/api/stats',auth,(_req,res)=>res.json({participants:db.users.length}));

app.get('/api/contacts',auth,(req,res)=>{
  req.user.contacts||=[]; const list=req.user.contacts.map(id=>db.users.find(u=>u.id===id)).filter(Boolean).map(u=>cleanUser(u,req.user)); res.json({contacts:list});
});
app.post('/api/contacts',auth,writeRateLimit,(req,res)=>{
  const q=String(req.body.query||'').trim(); const phone=normalizePhone(q), username=normalizeUsername(q).toLowerCase();
  const u=db.users.find(x=>x.id!==req.user.id&&(x.phone===phone||x.username.toLowerCase()===username));
  if(!u)return res.status(404).json({error:'Пользователь не найден'});
  req.user.blocked||=[]; u.blocked||=[]; if(req.user.blocked.includes(u.id)||u.blocked.includes(req.user.id))return res.status(403).json({error:'Контакт недоступен из-за блокировки'});
  req.user.contacts||=[]; if(!req.user.contacts.includes(u.id))req.user.contacts.push(u.id); saveDb(); res.json({contact:cleanUser(u,req.user)});
});
app.delete('/api/contacts/:id',auth,(req,res)=>{ req.user.contacts=(req.user.contacts||[]).filter(id=>id!==req.params.id); saveDb(); res.json({ok:true}); });
app.post('/api/users/:id/block',auth,(req,res)=>{ const peer=db.users.find(u=>u.id===req.params.id); if(!peer)return res.status(404).json({error:'Пользователь не найден'}); if(peer.id===req.user.id)return res.status(400).json({error:'Нельзя заблокировать себя'}); req.user.blocked||=[]; if(!req.user.blocked.includes(peer.id))req.user.blocked.push(peer.id); req.user.contacts=(req.user.contacts||[]).filter(id=>id!==peer.id); saveDb(); res.json({ok:true,blocked:true}); });
app.delete('/api/users/:id/block',auth,(req,res)=>{ req.user.blocked=(req.user.blocked||[]).filter(id=>id!==req.params.id); saveDb(); res.json({ok:true,blocked:false}); });
app.delete('/api/private/:id/messages',auth,(req,res)=>{ const peer=db.users.find(u=>u.id===req.params.id); if(!peer)return res.status(404).json({error:'Пользователь не найден'}); db.messages=db.messages.filter(m=>!((m.chatType||'global')==='private'&&((m.userId===req.user.id&&m.recipientId===peer.id)||(m.userId===peer.id&&m.recipientId===req.user.id)))); saveDb(); io.to(req.user.id).emit('private-chat-cleared',{peerId:peer.id}); io.to(peer.id).emit('private-chat-cleared',{peerId:req.user.id}); res.json({ok:true}); });

function canSeeMessage(m,u){
  if((m.hiddenFor||[]).includes(u.id))return false;
  if((m.chatType||'global')==='global')return true;
  if((m.chatType||'global')==='channel')return canAccessChannel(channelFor(m.channelId),u);
  return m.userId===u.id||m.recipientId===u.id;
}
function sameConversation(a,b){
  if((a.chatType||'global')!==(b.chatType||'global'))return false;
  if((a.chatType||'global')==='global')return true;
  if((a.chatType||'global')==='channel')return a.channelId===b.channelId;
  return [a.userId,a.recipientId].sort().join('|')===[b.userId,b.recipientId].sort().join('|');
}
function serializeMessage(m,viewer){
  const sender=db.users.find(u=>u.id===m.userId);
  const anonymousSender={id:null,username:'Аноним',verified:false,isAdmin:false,avatarUrl:'',featuredGift:null};
  const visibleSender=sender?cleanUser(sender):{id:null,username:'Удалённый пользователь',verified:false,isAdmin:false,avatarUrl:'',featuredGift:null};
  const reactions={}; for(const [emoji,ids] of Object.entries(m.reactions||{}))if(ids.length)reactions[emoji]={count:ids.length,mine:ids.includes(viewer.id)};
  const reply=m.replyTo?db.messages.find(x=>x.id===m.replyTo):null; const replySender=reply?db.users.find(u=>u.id===reply.userId):null;
  const hiddenByAnon=!!m.anonymous&&!viewer.isAdmin;
  const gift=m.giftId?giftRecord(m.giftId):null; const giftInfo=gift?giftSummary(gift.id):null; const giftSender=gift?db.users.find(u=>u.id===gift.senderId):null;
  return {
    id:m.id,text:m.text||'',type:m.type||'text',mediaUrl:m.mediaUrl||'',fileName:m.fileName||'',mime:m.mime||'',createdAt:m.createdAt,
    anonymous:!!m.anonymous,mine:viewer.id===m.userId,sender:hiddenByAnon?anonymousSender:visibleSender,
    anonymousRealSender:m.anonymous&&viewer.isAdmin&&sender?{id:sender.id,username:sender.username,phone:sender.phone}:null,
    chatType:m.chatType||'global',recipientId:m.recipientId||null,channelId:m.channelId||null,views:(m.viewers||[]).length,reactions,pinned:!!m.pinned,
    gift:gift&&giftInfo?{...giftInfo,letter:gift.letter||'',sender:giftSender?cleanUser(giftSender):null}:null,
    poll:m.poll?{question:m.poll.question,options:(m.poll.options||[]).map(o=>({id:o.id,text:o.text,count:(o.voters||[]).length,mine:(o.voters||[]).includes(viewer.id)}))}:null,
    replyTo:reply?{id:reply.id,text:(reply.text||({image:'Фото',video:'Видео',audio:'Голосовое',gift:'Подарок'}[reply.type]||'')).slice(0,90),sender:replySender?.username||'Пользователь'}:null
  };
}
app.get('/api/messages',auth,(req,res)=>{
  const peer=String(req.query.peer||''), channelId=String(req.query.channel||''); let items=db.messages.filter(m=>canSeeMessage(m,req.user));
  if(channelId){
    const c=channelFor(channelId);if(!canAccessChannel(c,req.user))return res.status(403).json({error:'Нет доступа к каналу'});
    items=items.filter(m=>(m.chatType||'global')==='channel'&&m.channelId===channelId);
  }else if(peer)items=items.filter(m=>(m.chatType||'global')==='private'&&((m.userId===req.user.id&&m.recipientId===peer)||(m.userId===peer&&m.recipientId===req.user.id)));
  else items=items.filter(m=>(m.chatType||'global')==='global');
  res.json({messages:items.slice(-300).map(m=>serializeMessage(m,req.user))});
});

// Gifts + strawberry currency
app.get('/api/gifts/catalog',auth,(_req,res)=>{const now=Date.now();res.json({catalog:db.giftCatalog.map(g=>{const releaseAt=g.releaseAt||null;const released=!releaseAt||new Date(releaseAt).getTime()<=now;return {...g,releaseAt,released,upcoming:!released,soldOut:g.remaining<=0};})})});
app.get('/api/gifts/mine',auth,(req,res)=>{
  const gifts=db.gifts.filter(g=>g.receiverId===req.user.id).slice().reverse().map(g=>({...giftSummary(g.id),letter:g.letter||'',createdAt:g.createdAt,sender:cleanUser(db.users.find(x=>x.id===g.senderId)||{id:null,username:'Пользователь',phone:''})}));
  res.json({gifts,featuredGiftId:req.user.featuredGiftId||null,balance:req.user.strawberries||0});
});
app.post('/api/gifts/send',auth,(req,res)=>{
  const recipient=db.users.find(u=>u.id===String(req.body.recipientId||'')); if(!recipient||recipient.id===req.user.id)return res.status(400).json({error:'Подарок можно отправить только собеседнику'});
  const def=giftDef(String(req.body.giftKey||'')); if(!def)return res.status(400).json({error:'Подарок не найден'}); if(def.releaseAt&&new Date(def.releaseAt).getTime()>Date.now())return res.status(400).json({error:'Этот подарок ещё не вышел на рынок'}); if((Number(def.remaining)||0)<=0)return res.status(400).json({error:'Подарок закончился на рынке'});
  const letter=String(req.body.letter||'').trim().slice(0,50); req.user.strawberries=Math.max(0,Number(req.user.strawberries)||0);
  if(req.user.strawberries<def.price)return res.status(400).json({error:`Не хватает клубничек: нужно ${def.price}🍓`});
  req.user.strawberries-=def.price; def.remaining=Math.max(0,(Number(def.remaining)||0)-1); const issued=(Number(def.totalSupply)||0)-def.remaining;
  const g={id:crypto.randomUUID(),giftKey:def.key,senderId:req.user.id,receiverId:recipient.id,letter,price:def.price,serial:def.type==='nft'?issued:null,createdAt:new Date().toISOString()}; db.gifts.push(g);
  const m={id:crypto.randomUUID(),userId:req.user.id,text:'',type:'gift',mediaUrl:'',fileName:'',mime:'',anonymous:false,chatType:'private',recipientId:recipient.id,createdAt:new Date().toISOString(),viewers:[],reactions:{},hiddenFor:[],replyTo:null,pinned:false,giftId:g.id};
  db.messages.push(m); if(db.messages.length>5000)db.messages=db.messages.slice(-5000); saveDb();
  io.emit('user-updated',cleanUser(req.user)); emitToViewers('message',m,viewer=>serializeMessage(m,viewer)); res.json({ok:true,balance:req.user.strawberries,gift:{...giftSummary(g.id),letter},message:serializeMessage(m,req.user)});
});
app.post('/api/gifts/feature',auth,(req,res)=>{
  const id=req.body.giftId||null; if(id){const g=db.gifts.find(x=>x.id===id&&x.receiverId===req.user.id);if(!g)return res.status(404).json({error:'Подарок не найден'});req.user.featuredGiftId=id;}else req.user.featuredGiftId=null;
  saveDb(); const user=cleanUser(req.user); io.emit('user-updated',user); res.json({user});
});

// Support chat
function getThread(userId,create=false){
  let t=db.supportThreads[userId];
  if(!t&&create){t={userId,visible:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};db.supportThreads[userId]=t;}
  return t||null;
}
function pushSupport(userId,from,text,extra={}){
  const t=getThread(userId,true); const msg={id:crypto.randomUUID(),from,text:String(text||'').slice(0,4000),createdAt:new Date().toISOString(),...extra}; t.messages.push(msg); t.updatedAt=msg.createdAt; t.visible=true; if(t.messages.length>500)t.messages=t.messages.slice(-500); return msg;
}
function serializeSupportMessage(msg,viewer,targetUser){
  let sender;
  if(msg.from==='user')sender=cleanUser(targetUser);
  else sender={id:null,username:msg.from==='admin'?'Поддержка':'чат с ботом',avatarUrl:'',verified:true,isAdmin:msg.from==='admin',featuredGift:null};
  const mine=viewer.isAdmin?msg.from==='admin':msg.from==='user';
  return {...msg,sender,mine,type:'support'};
}
function miniAiReply(text){
  const t=String(text||'').toLowerCase();
  if(/привет|здравств|hello|hi\b/.test(t))return 'Привет! Я бот поддержки 205chating. Могу помочь с аккаунтом, личными сообщениями, подарками, клубничками, фото/видео и настройками.';
  if(/парол|войти|вход|логин/.test(t))return 'Если не получается войти, проверь @username или номер +7XXXXXXXXXX и пароль. Пароль должен быть не короче 6 символов. Если доступ всё равно потерян — напиши, какой именно аккаунт не открывается, администратор подключится.';
  if(/^#?\s*сотрудничество/.test(t))return 'По вопросам сотрудничества напиши на 67io67676767@gmail.com';
  if(/^#?\s*рассказать об ошибке/.test(t))return 'Опиши ошибку как можно подробнее: что нажал(а), что ожидал(а) увидеть и что произошло. Сообщение останется в этом чате и будет доступно администратору поддержки.';
  if(/клубнич|баланс|пополн|купить|оплат/.test(t))return 'Нажми на поле сообщения — сверху появится команда «# пополнить клубнички🍓». Выбери пакет, переведи сумму на номер, который я пришлю, а после перевода напиши «успешно✅».';
  if(/подар|nft|нфт|рынок/.test(t))return 'Подарки можно отправлять только в личных сообщениях. Нажми кнопку подарка → откроется Рынок. Выбери подарок, добавь письмо до 50 символов и отправь другу.';
  if(/голос|микроф|аудио/.test(t))return 'Для голосовых разреши сайту доступ к микрофону. Начни запись, а когда закончишь — нажми обычную кнопку отправки.';
  if(/камер|треуг|квадрат|видео/.test(t))return 'Для видео-треугольника разреши камеру и микрофон. Максимальная длина — 59 секунд; для отправки нажми обычную кнопку отправки.';
  if(/аватар|фото проф|профил/.test(t))return 'Аватар и «О себе» меняются в профиле. Username тоже можно изменить, если новый @username свободен.';
  if(/контакт|личн|друг/.test(t))return 'Чтобы начать личную переписку, выбери «Добавить контакт» и введи номер телефона или @username.';
  if(/жалоб|оскорб|спам|мошен/.test(t))return 'Опиши ситуацию подробнее: кто написал, что произошло и примерно когда. Сообщение увидит администратор и сможет ответить в этом же чате.';
  if(/удал|сообщен/.test(t))return 'У своего сообщения открой меню ⋯. Там можно удалить его у себя. Администратор дополнительно может удалить сообщение у всех.';
  if(/тем|светл|темн|язык/.test(t))return 'Тема и язык меняются в Настройках. На телефоне экран настроек открывается поверх интерфейса.';
  if(t.length<8)return 'Расскажи чуть подробнее, что именно не работает — я попробую подсказать.';
  return 'Я пока простой помощник, но попробую разобраться. Уточни: это проблема с аккаунтом, сообщениями, медиа, подарками/🍓 или жалоба на пользователя? Если я не помогу, позже ответит администратор.';
}
function emitSupportUpdate(userId){ for(const s of io.sockets.sockets.values())if(s.user.id===userId||s.user.isAdmin)s.emit('support-updated',{userId}); }
app.get('/api/support/status',auth,(req,res)=>{const t=getThread(req.user.id,false);res.json({visible:!!t?.visible,hasThread:!!t,isAdmin:req.user.isAdmin});});
app.post('/api/support/open',auth,(req,res)=>{
  const existed=!!getThread(req.user.id,false); const t=getThread(req.user.id,true); t.visible=true;
  if(!existed||!t.messages.length)pushSupport(req.user.id,'bot','Здравствуйте! Я бот поддержки 205chating. Попробую сам помочь с обычными вопросами, а если не получится — позже здесь ответит администратор. Опишите проблему или жалобу.');
  saveDb(); emitSupportUpdate(req.user.id); res.json({ok:true});
});
app.delete('/api/support/hide',auth,(req,res)=>{const t=getThread(req.user.id,false);if(t)t.visible=false;saveDb();emitSupportUpdate(req.user.id);res.json({ok:true});});
app.get('/api/support/messages',auth,(req,res)=>{const t=getThread(req.user.id,true);res.json({messages:t.messages.map(m=>serializeSupportMessage(m,req.user,req.user))});});
app.post('/api/support/messages',auth,(req,res)=>{const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'Напишите сообщение'});const t=getThread(req.user.id,true);const m=pushSupport(req.user.id,'user',text);let botMessage=null;if(!t.humanJoined){
  if(/^успешно\s*✅?$/i.test(text)){
    const pp=db.premiumRequests.filter(x=>x.userId===req.user.id&&x.status==='pending').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const p=db.purchases.filter(x=>x.userId===req.user.id&&x.status==='pending').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if(pp){pp.status='paid';pp.updatedAt=new Date().toISOString();botMessage=pushSupport(req.user.id,'bot',`Спасибо! Заявка на Chatics Premium (${pp.months} мес.) отправлена администратору на проверку. После подтверждения Premium активируется автоматически.`);}
    else if(p){p.status='paid';p.updatedAt=new Date().toISOString();botMessage=pushSupport(req.user.id,'bot',`Спасибо! Заявка на ${p.berries}🍓 отправлена администратору на проверку. После подтверждения клубнички появятся на балансе.`);}
    else botMessage=pushSupport(req.user.id,'bot','Не вижу активной заявки. Сначала выбери пакет клубничек или тариф Chatics Premium.');
  }
  else botMessage=pushSupport(req.user.id,'bot',miniAiReply(text));
}saveDb();emitSupportUpdate(req.user.id);res.json({message:serializeSupportMessage(m,req.user,req.user),botMessage:botMessage?serializeSupportMessage(botMessage,req.user,req.user):null});});
app.get('/api/admin/support/threads',auth,adminOnly,(req,res)=>{
  const threads=Object.values(db.supportThreads).map(t=>{const u=db.users.find(x=>x.id===t.userId);const last=t.messages[t.messages.length-1];return u?{user:cleanUser(u),updatedAt:t.updatedAt||t.createdAt,lastText:last?.text||'',lastFrom:last?.from||'',count:t.messages.length}:null}).filter(Boolean).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({threads});
});
app.get('/api/admin/support/:userId/messages',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});const t=getThread(u.id,true);res.json({user:cleanUser(u),messages:t.messages.map(m=>serializeSupportMessage(m,req.user,u))});});
app.post('/api/admin/support/:userId/messages',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'Напишите ответ'});const t=getThread(u.id,true);t.humanJoined=true;const m=pushSupport(u.id,'admin',text);saveDb();emitSupportUpdate(u.id);res.json({message:serializeSupportMessage(m,req.user,u)});});


app.post('/api/support/purchase',auth,(req,res)=>{
  const pack=PURCHASE_PACKAGES.find(p=>p.id===req.body.packageId);if(!pack)return res.status(400).json({error:'Пакет не найден'});
  const existing=db.purchases.find(p=>p.userId===req.user.id&&p.packageId===pack.id&&['pending','paid'].includes(p.status));if(existing)return res.status(409).json({error:'У вас уже есть незавершённая заявка на этот пакет'});
  const p={id:crypto.randomUUID(),userId:req.user.id,packageId:pack.id,berries:pack.berries,rub:pack.rub,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.purchases.push(p);
  pushSupport(req.user.id,'bot',`Для пополнения ${pack.berries}🍓 переведи ${pack.rub}₽ на номер ${PAYMENT_PHONE}. После перевода напиши здесь: успешно✅`);
  saveDb();emitSupportUpdate(req.user.id);res.json({purchase:p,paymentPhone:PAYMENT_PHONE});
});

// Серии личных чатов удалены в 0.1.5v.

// Admin gift/NFT market
app.get('/api/admin/gifts',auth,adminOnly,(_req,res)=>res.json({catalog:db.giftCatalog.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}));
app.post('/api/admin/gifts',auth,adminOnly,upload.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Загрузите изображение'});
  const giftExt=path.extname(req.file.originalname||'').toLowerCase(); const giftLooksImage=req.file.mimetype.startsWith('image/')||(['.jpg','.jpeg','.png','.webp','.gif','.avif'].includes(giftExt)); if(!giftLooksImage){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Нужно изображение JPG, PNG, WEBP, GIF или AVIF'})}
  const name=String(req.body.name||'').trim().slice(0,60), price=Math.trunc(Number(req.body.price)), totalSupply=Math.trunc(Number(req.body.quantity)), type=req.body.type==='nft'?'nft':'gift';
  const releaseRaw=String(req.body.releaseAt||'').trim(); let releaseAt=null;
  if(releaseRaw){const d=new Date(releaseRaw);if(Number.isNaN(d.getTime()))return res.status(400).json({error:'Некорректная дата выхода'});releaseAt=d.toISOString();}
  if(name.length<2)return res.status(400).json({error:'Введите название'});
  if(!Number.isFinite(price)||price<1)return res.status(400).json({error:'Цена должна быть больше 0'});
  if(!Number.isFinite(totalSupply)||totalSupply<1)return res.status(400).json({error:'Количество должно быть больше 0'});
  const id=crypto.randomUUID(), key='market-'+id;
  const item={id,key,name,price,image:`/uploads/${req.file.filename}`,type,totalSupply,remaining:totalSupply,createdAt:new Date().toISOString(),releaseAt,createdBy:req.user.id};
  db.giftCatalog.push(item);saveDb();res.json({item});
});
app.patch('/api/admin/gifts/:id',auth,adminOnly,(req,res)=>{
  const g=db.giftCatalog.find(x=>x.id===req.params.id||x.key===req.params.id);if(!g)return res.status(404).json({error:'Подарок не найден'});
  if(Object.prototype.hasOwnProperty.call(req.body,'price')){const v=Math.trunc(Number(req.body.price));if(!Number.isFinite(v)||v<1)return res.status(400).json({error:'Некорректная цена'});g.price=v}
  if(Object.prototype.hasOwnProperty.call(req.body,'remaining')){const v=Math.trunc(Number(req.body.remaining));if(!Number.isFinite(v)||v<0)return res.status(400).json({error:'Некорректное количество'});g.remaining=v;g.totalSupply=Math.max(g.totalSupply||0,v)}
  if(Object.prototype.hasOwnProperty.call(req.body,'addQuantity')){if(g.type!=='nft')return res.status(400).json({error:'Добавлять выпуск можно только NFT'});const v=Math.trunc(Number(req.body.addQuantity));if(!Number.isFinite(v)||v<1)return res.status(400).json({error:'Укажи количество NFT больше 0'});g.totalSupply=Math.max(0,Number(g.totalSupply)||0)+v;g.remaining=Math.max(0,Number(g.remaining)||0)+v;}
  if(Object.prototype.hasOwnProperty.call(req.body,'releaseAt')){const raw=String(req.body.releaseAt||'').trim();if(!raw)g.releaseAt=null;else{const d=new Date(raw);if(Number.isNaN(d.getTime()))return res.status(400).json({error:'Некорректная дата выхода'});g.releaseAt=d.toISOString();}}
  saveDb();res.json({item:g});
});
app.delete('/api/admin/gifts/:id',auth,adminOnly,(req,res)=>{
  const i=db.giftCatalog.findIndex(x=>x.id===req.params.id||x.key===req.params.id);if(i<0)return res.status(404).json({error:'Подарок не найден'});
  db.giftCatalog.splice(i,1);saveDb();res.json({ok:true});
});

// Referral links
app.get('/api/admin/referrals',auth,adminOnly,(_req,res)=>res.json({referrals:db.referrals.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(r=>({...r,claims:r.claimedUserIds.length}))}));
app.post('/api/admin/referrals',auth,adminOnly,(req,res)=>{
  const berries=Math.trunc(Number(req.body.berries));if(!Number.isFinite(berries)||berries<1)return res.status(400).json({error:'Количество клубничек должно быть больше 0'});
  let code='';do{code=crypto.randomBytes(5).toString('base64url')}while(db.referrals.some(r=>r.code===code));
  const referral={id:crypto.randomUUID(),code,berries,createdAt:new Date().toISOString(),createdBy:req.user.id,claimedUserIds:[]};db.referrals.push(referral);saveDb();res.json({referral:{...referral,claims:0}});
});
app.post('/api/referrals/claim',auth,(req,res)=>{
  const code=String(req.body.code||'').trim();const r=db.referrals.find(x=>x.code===code);if(!r)return res.status(404).json({error:'Реферальная ссылка недействительна'});
  r.claimedUserIds||=[];if(r.claimedUserIds.includes(req.user.id))return res.json({ok:true,alreadyClaimed:true,balance:req.user.strawberries||0});
  req.user.strawberries=Math.max(0,Number(req.user.strawberries)||0)+r.berries;r.claimedUserIds.push(req.user.id);saveDb();io.emit('user-updated',cleanUser(req.user));res.json({ok:true,berries:r.berries,balance:req.user.strawberries});
});


app.delete('/api/admin/referrals/:id',auth,adminOnly,(req,res)=>{
  const i=db.referrals.findIndex(r=>r.id===req.params.id);if(i<0)return res.status(404).json({error:'Реферальная ссылка не найдена'});
  db.referrals.splice(i,1);saveDb();res.json({ok:true});
});

// Chatics Premium
app.get('/api/premium',auth,(req,res)=>res.json({active:isPremium(req.user),until:req.user.premiumUntil||null,plans:[{months:1,rub:139},{months:3,rub:319},{months:6,rub:509}]}));
app.post('/api/premium/purchase',auth,(req,res)=>{
  const months=Number(req.body.months),rub=premiumPlan(months);if(!rub)return res.status(400).json({error:'Неверный тариф'});
  const existing=db.premiumRequests.find(p=>p.userId===req.user.id&&['pending','paid'].includes(p.status));
  if(existing)return res.status(409).json({error:'У тебя уже есть заявка Premium на проверке'});
  const p={id:crypto.randomUUID(),userId:req.user.id,months,rub,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  db.premiumRequests.push(p);
  pushSupport(req.user.id,'bot',`Chatics Premium 👑\nТариф: ${months} мес. — ${rub}₽\nПереведи ${rub}₽ на ${PAYMENT_PHONE}. После оплаты напиши «успешно✅». Администратор проверит перевод и выдаст Premium.`,{premiumRequestId:p.id});
  saveDb();emitSupportUpdate(req.user.id);res.json({request:p,paymentPhone:PAYMENT_PHONE});
});
app.get('/api/admin/premium-requests',auth,adminOnly,(req,res)=>res.json({requests:db.premiumRequests.slice().reverse().map(p=>({...p,user:cleanUser(db.users.find(u=>u.id===p.userId)||{id:null,username:'Удалён',phone:''})}))}));
app.post('/api/admin/premium-requests/:id/approve',auth,adminOnly,(req,res)=>{
  const p=db.premiumRequests.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});
  const u=db.users.find(x=>x.id===p.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});
  const base=Math.max(Date.now(),u.premiumUntil?new Date(u.premiumUntil).getTime():0);const d=new Date(base);d.setMonth(d.getMonth()+p.months);u.premiumUntil=d.toISOString();p.status='approved';p.updatedAt=new Date().toISOString();p.approvedBy=req.user.id;saveDb();io.emit('user-updated',cleanUser(u));emitSupportUpdate(u.id);res.json({ok:true,user:adminUser(u)});
});
app.post('/api/admin/premium-requests/:id/reject',auth,adminOnly,(req,res)=>{
  const p=db.premiumRequests.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});
  p.status='rejected';p.updatedAt=new Date().toISOString();saveDb();emitSupportUpdate(p.userId);res.json({ok:true});
});

// 0.1.8v: пользовательские каналы удалены. Старые клиенты получают пустой список, все изменения заблокированы.
app.use('/api/channels',(req,res,next)=>{
  if(req.method==='GET' && (req.path==='/'||req.path===''))return res.json({channels:[]});
  return res.status(410).json({error:'Пользовательские каналы удалены в версии 0.1.8v'});
});

// Premium channels (legacy routes below are unreachable and kept only for migration compatibility)
app.get('/api/channels',auth,(req,res)=>{
  const channels=db.channels.filter(c=>canAccessChannel(c,req.user)).map(c=>({...c,owner:cleanUser(db.users.find(u=>u.id===c.ownerId)||{id:null,username:'Удалён',phone:''}),mine:c.ownerId===req.user.id}));
  res.json({channels});
});
app.post('/api/channels',auth,(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,60);if(name.length<2)return res.status(400).json({error:'Название канала слишком короткое'});
  const isPublic=req.body.isPublic!==false;const inviteNames=Array.isArray(req.body.invites)?req.body.invites:[];
  const members=[...new Set(inviteNames.map(x=>normalizeUsername(x).toLowerCase()).map(n=>db.users.find(u=>u.username.toLowerCase()===n)?.id).filter(Boolean).filter(id=>id!==req.user.id))];
  const c={id:crypto.randomUUID(),name,description:'',avatarUrl:'',ownerId:req.user.id,isPublic,members,createdAt:new Date().toISOString()};db.channels.push(c);saveDb();res.json({channel:{...c,owner:cleanUser(req.user),mine:true}});
});
app.post('/api/channels/:id/invite',auth,(req,res)=>{
  const c=channelFor(req.params.id);if(!c)return res.status(404).json({error:'Канал не найден'});if(c.ownerId!==req.user.id)return res.status(403).json({error:'Только создатель канала может приглашать'});
  const username=normalizeUsername(req.body.username).toLowerCase(),u=db.users.find(x=>x.username.toLowerCase()===username);if(!u)return res.status(404).json({error:'Пользователь не найден'});
  c.members||=[];if(!c.members.includes(u.id))c.members.push(u.id);saveDb();res.json({ok:true});
});
app.patch('/api/channels/:id',auth,(req,res)=>{const c=channelFor(req.params.id);if(!c)return res.status(404).json({error:'Канал не найден'});if(c.ownerId!==req.user.id)return res.status(403).json({error:'Только создатель может менять канал'});if(req.body.name!==undefined){const n=String(req.body.name).trim().slice(0,60);if(n.length<2)return res.status(400).json({error:'Название слишком короткое'});c.name=n}if(req.body.description!==undefined)c.description=String(req.body.description||'').slice(0,500);if(req.body.isPublic!==undefined)c.isPublic=!!req.body.isPublic;if(Array.isArray(req.body.members))c.members=[...new Set(req.body.members.filter(id=>db.users.some(u=>u.id===id)&&id!==req.user.id))];saveDb();io.emit('channels-updated');res.json({channel:{...c,mine:true,owner:cleanUser(req.user)}})});
app.post('/api/channels/:id/avatar',auth,upload.single('avatar'),(req,res)=>{const c=channelFor(req.params.id);if(!c)return res.status(404).json({error:'Канал не найден'});if(c.ownerId!==req.user.id)return res.status(403).json({error:'Только создатель может менять канал'});if(!req.file)return res.status(400).json({error:'Выберите изображение'});c.avatarUrl='/uploads/'+req.file.filename;saveDb();io.emit('channels-updated');res.json({channel:c})});
app.delete('/api/channels/:id',auth,(req,res)=>{const c=channelFor(req.params.id);if(!c)return res.status(404).json({error:'Канал не найден'});if(c.ownerId!==req.user.id&&!req.user.isAdmin)return res.status(403).json({error:'Недостаточно прав'});db.channels=db.channels.filter(x=>x.id!==c.id);db.messages=db.messages.filter(m=>m.channelId!==c.id);saveDb();io.emit('channels-updated');res.json({ok:true})});
app.get('/api/admin/analytics',auth,adminOnly,(req,res)=>{const now=Date.now(),day=86400000;const registrations=[];for(let i=13;i>=0;i--){const d=new Date(now-i*day),key=d.toISOString().slice(0,10);registrations.push({date:key,count:db.users.filter(u=>String(u.createdAt||'').slice(0,10)===key).length})}res.json({online:db.users.filter(u=>u.online).length,users:db.users.length,messages:db.messages.length,privateMessages:db.messages.filter(m=>(m.chatType||'global')==='private').length,stocks:db.stocks.length,stockTrades:db.stockTrades.length,gifts:db.gifts.length,premium:db.users.filter(isPremium).length,registrations})});


// Virtual stock market — internal strawberries only, no cash-out.
app.get('/api/stocks/market',auth,(req,res)=>res.json({stocks:db.stocks.map(s=>stockSummary(s,req.user,{history:true})),balance:roundBerry(req.user.strawberries),walletOpened:!!req.user.stockWalletOpened,basePrice:STOCK_BASE_PRICE}));
app.get('/api/stocks/wallet',auth,(req,res)=>{
  const portfolio=db.stockHoldings[req.user.id]||{};
  const holdings=Object.entries(portfolio).map(([id,qty])=>{const s=stockFor(id);return s?{...stockSummary(s,req.user,{history:true}),qty:Math.max(0,Math.trunc(Number(qty)||0)),value:roundBerry(stockPrice(s)*Math.max(0,Math.trunc(Number(qty)||0)))}:null}).filter(Boolean);
  const created=db.stocks.filter(s=>s.creatorId===req.user.id).map(s=>stockSummary(s,req.user,{history:true}));
  res.json({opened:!!req.user.stockWalletOpened,balance:roundBerry(req.user.strawberries),holdings,created,maxCreated:STOCK_MAX_CREATED});
});
app.post('/api/stocks/wallet/open',auth,(req,res)=>{req.user.stockWalletOpened=true;saveDb();res.json({opened:true,user:cleanUser(req.user,req.user)});});
app.post('/api/stocks',auth,upload.single('avatar'),(req,res)=>{
  if(!isPremium(req.user))return res.status(403).json({error:'Создание акций доступно только в Chatics Premium'});
  if(db.stocks.filter(s=>s.creatorId===req.user.id).length>=STOCK_MAX_CREATED)return res.status(400).json({error:`Можно создать не больше ${STOCK_MAX_CREATED} акций`});
  const name=String(req.body.name||'').trim().slice(0,40);if(name.length<2)return res.status(400).json({error:'Название акции слишком короткое'});
  if(!req.file)return res.status(400).json({error:'Загрузите аватарку акции'});
  const ext=path.extname(req.file.originalname||'').toLowerCase(),mime=String(req.file.mimetype||'').toLowerCase();if(!mime.startsWith('image/')&&!['.jpg','.jpeg','.png','.webp','.gif','.avif'].includes(ext)){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Аватарка должна быть изображением'});}
  const now=new Date().toISOString();const stock={id:crypto.randomUUID(),name,avatarUrl:`/uploads/${req.file.filename}`,creatorId:req.user.id,verified:false,circulating:0,createdAt:now,priceHistory:[{at:now,price:STOCK_BASE_PRICE}]};db.stocks.push(stock);req.user.stockWalletOpened=true;saveDb();io.emit('stocks-updated');res.json({stock:stockSummary(stock,req.user,{history:true}),user:cleanUser(req.user,req.user)});
});
app.patch('/api/stocks/:id/avatar',auth,upload.single('avatar'),(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});if(stock.creatorId!==req.user.id)return res.status(403).json({error:'Настройки доступны создателю акции'});if(!req.file)return res.status(400).json({error:'Выберите изображение'});const ext=path.extname(req.file.originalname||'').toLowerCase(),mime=String(req.file.mimetype||'').toLowerCase();if(!mime.startsWith('image/')&&!['.jpg','.jpeg','.png','.webp','.gif','.avif'].includes(ext)){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Нужно изображение'});}stock.avatarUrl=`/uploads/${req.file.filename}`;saveDb();io.emit('stocks-updated');res.json({stock:stockSummary(stock,req.user,{history:true})})});
app.delete('/api/stocks/:id',auth,(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});if(stock.creatorId!==req.user.id&&!req.user.isAdmin)return res.status(403).json({error:'Недостаточно прав'});const refunded=deleteStockWithRefund(stock);saveDb();io.emit('stocks-updated');io.emit('balances-updated');res.json({ok:true,refunded})});
app.post('/api/stocks/:id/buy',auth,writeRateLimit,(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});if(!req.user.stockWalletOpened)return res.status(403).json({error:'Сначала откройте кошелёк акций'});if(stock.creatorId===req.user.id)return res.status(400).json({error:'Создатель не может покупать собственную акцию'});const qty=Math.trunc(Number(req.body.qty));if(!Number.isFinite(qty)||qty<1||qty>5000)return res.status(400).json({error:'Количество: от 1 до 5000'});const before=Math.max(0,Math.trunc(Number(stock.circulating)||0));if(before+qty>20000)return res.status(400).json({error:'Для этой акции достигнут лимит выпуска'});const cost=stockCurveCost(before,qty);req.user.strawberries=roundBerry(req.user.strawberries);if(req.user.strawberries+1e-9<cost)return res.status(400).json({error:`Не хватает клубничек: нужно ${cost}🍓`});req.user.strawberries=roundBerry(req.user.strawberries-cost);setStockHolding(req.user.id,stock.id,stockHolding(req.user.id,stock.id)+qty);stock.circulating=before+qty;recordStockPoint(stock);const trade={id:crypto.randomUUID(),stockId:stock.id,userId:req.user.id,type:'buy',qty,total:cost,priceBefore:Math.max(STOCK_BASE_PRICE,Math.round(STOCK_BASE_PRICE*Math.pow(STOCK_GROWTH,before)*10000)/10000),priceAfter:stockPrice(stock),createdAt:new Date().toISOString()};db.stockTrades.push(trade);db.stockTrades=db.stockTrades.slice(-5000);saveDb();io.emit('stocks-updated');io.emit('user-updated',cleanUser(req.user));res.json({stock:stockSummary(stock,req.user,{history:true}),holding:stockHolding(req.user.id,stock.id),balance:roundBerry(req.user.strawberries),trade})});
app.post('/api/stocks/:id/sell',auth,writeRateLimit,(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});if(!req.user.stockWalletOpened)return res.status(403).json({error:'Сначала откройте кошелёк акций'});const qty=Math.trunc(Number(req.body.qty)),owned=stockHolding(req.user.id,stock.id);if(!Number.isFinite(qty)||qty<1||qty>owned)return res.status(400).json({error:`Можно продать от 1 до ${owned}`});const before=Math.max(0,Math.trunc(Number(stock.circulating)||0));const start=Math.max(0,before-qty);const gross=stockCurveCost(start,qty);const payout=roundBerry(gross*STOCK_SELL_FACTOR);setStockHolding(req.user.id,stock.id,owned-qty);stock.circulating=start;req.user.strawberries=roundBerry((Number(req.user.strawberries)||0)+payout);recordStockPoint(stock);const trade={id:crypto.randomUUID(),stockId:stock.id,userId:req.user.id,type:'sell',qty,total:payout,priceBefore:Math.max(STOCK_BASE_PRICE,Math.round(STOCK_BASE_PRICE*Math.pow(STOCK_GROWTH,before)*10000)/10000),priceAfter:stockPrice(stock),createdAt:new Date().toISOString()};db.stockTrades.push(trade);db.stockTrades=db.stockTrades.slice(-5000);saveDb();io.emit('stocks-updated');io.emit('user-updated',cleanUser(req.user));res.json({stock:stockSummary(stock,req.user,{history:true}),holding:stockHolding(req.user.id,stock.id),balance:roundBerry(req.user.strawberries),trade})});
app.get('/api/admin/stocks',auth,adminOnly,(req,res)=>res.json({stocks:db.stocks.map(s=>stockSummary(s,req.user,{history:true}))}));
app.patch('/api/admin/stocks/:id/verified',auth,adminOnly,(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});stock.verified=!!req.body.verified;saveDb();io.emit('stocks-updated');res.json({stock:stockSummary(stock,req.user,{history:true})})});
app.delete('/api/admin/stocks/:id',auth,adminOnly,(req,res)=>{const stock=stockFor(req.params.id);if(!stock)return res.status(404).json({error:'Акция не найдена'});const refunded=deleteStockWithRefund(stock);saveDb();io.emit('stocks-updated');io.emit('balances-updated');res.json({ok:true,refunded})});

// Strawberry purchases: manual payment verification by admin
app.get('/api/strawberries/packages',auth,(_req,res)=>res.json({packages:PURCHASE_PACKAGES,paymentPhone:PAYMENT_PHONE}));
app.post('/api/strawberries/purchase',auth,(req,res)=>{
  const pack=PURCHASE_PACKAGES.find(p=>p.id===req.body.packageId); if(!pack)return res.status(400).json({error:'Пакет не найден'});
  const existing=db.purchases.find(p=>p.userId===req.user.id&&p.packageId===pack.id&&['pending','paid'].includes(p.status)); if(existing)return res.status(409).json({error:'У вас уже есть незавершённая заявка на этот пакет'});
  const p={id:crypto.randomUUID(),userId:req.user.id,packageId:pack.id,berries:pack.berries,rub:pack.rub,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; db.purchases.push(p);
  saveDb(); res.json({purchase:p,paymentPhone:PAYMENT_PHONE});
});
app.post('/api/strawberries/purchase/:id/paid',auth,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(p.status!=='pending')return res.status(400).json({error:'Заявка уже обработана'});p.status='paid';p.updatedAt=new Date().toISOString();saveDb();res.json({purchase:p});});
app.get('/api/strawberries/purchases/mine',auth,(req,res)=>res.json({purchases:db.purchases.filter(p=>p.userId===req.user.id).slice().reverse()}));

// Maintenance
app.get('/api/maintenance',(_req,res)=>{const until=db.maintenanceUntil&&new Date(db.maintenanceUntil).getTime()>Date.now()?db.maintenanceUntil:null;if(!until&&db.maintenanceUntil){db.maintenanceUntil=null;saveDb();}res.json({active:!!until,until});});
app.post('/api/admin/maintenance',auth,adminOnly,(req,res)=>{const minutes=Math.trunc(Number(req.body.minutes));if(!Number.isFinite(minutes)||minutes<1)return res.status(400).json({error:'Укажите количество минут больше 0'});db.maintenanceUntil=new Date(Date.now()+minutes*60000).toISOString();saveDb();io.emit('maintenance',{active:true,until:db.maintenanceUntil});res.json({active:true,until:db.maintenanceUntil});});
app.delete('/api/admin/maintenance',auth,adminOnly,(req,res)=>{db.maintenanceUntil=null;saveDb();io.emit('maintenance',{active:false,until:null});res.json({active:false});});

// Admin
app.get('/api/admin/users',auth,adminOnly,(req,res)=>res.json({users:db.users.map(adminUser)}));
app.patch('/api/admin/users/:id/verified',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});if(isRootAdmin(u))return res.status(400).json({error:'Галочка главного администратора постоянная'});u.verified=!!req.body.verified;saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.patch('/api/admin/users/:id/admin',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});if(isRootAdmin(u))return res.status(400).json({error:'Нельзя изменить роль главного администратора'});u.isAdmin=!!req.body.isAdmin;if(u.isAdmin)u.verified=true;saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.post('/api/admin/users/:id/strawberries',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});const amount=Math.trunc(Number(req.body.amount));if(!Number.isFinite(amount)||amount===0)return res.status(400).json({error:'Введите целое количество, кроме 0'});u.strawberries=Math.max(0,(Number(u.strawberries)||0)+amount);saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.delete('/api/admin/users/:id',auth,adminOnly,(req,res)=>{
  const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});
  if(isRootAdmin(u))return res.status(400).json({error:'Нельзя удалить аккаунт главного администратора'});
  for(const stock of db.stocks.filter(s=>s.creatorId===u.id).slice())deleteStockWithRefund(stock);
  removeUserStockHoldings(u.id);
  db.users=db.users.filter(x=>x.id!==u.id);
  db.messages=db.messages.filter(m=>m.userId!==u.id&&m.recipientId!==u.id);
  db.gifts=db.gifts.filter(g=>g.receiverId!==u.id&&g.senderId!==u.id);
  db.purchases=db.purchases.filter(p=>p.userId!==u.id);
  db.premiumRequests=db.premiumRequests.filter(p=>p.userId!==u.id);
  db.channels=db.channels.filter(c=>c.ownerId!==u.id).map(c=>({...c,members:(c.members||[]).filter(id=>id!==u.id)}));
  delete db.supportThreads[u.id];
  for(const x of db.users){x.contacts=(x.contacts||[]).filter(id=>id!==u.id);x.blocked=(x.blocked||[]).filter(id=>id!==u.id);}
  saveDb();
  for(const sock of io.sockets.sockets.values())if(sock.user?.id===u.id){sock.emit('account-deleted');sock.disconnect(true);}
  io.emit('participants',db.users.length);
  res.json({ok:true});
});
app.get('/api/admin/users/search',auth,adminOnly,(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase(); const phone=normalizePhone(q);
  const users=db.users.filter(u=>!q||u.username.toLowerCase().includes(q.replace(/^@/,''))||u.phone.includes(phone||q)).map(adminUser);
  res.json({users});
});
app.get('/api/admin/audit/users',auth,adminOnly,(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase(); const phone=normalizePhone(q);
  const users=db.users.filter(u=>!q||u.username.toLowerCase().includes(q.replace(/^@/,''))||u.phone.includes(phone||q)).map(cleanUser);
  res.json({users});
});
app.get('/api/admin/audit/conversations/:userId',auth,adminOnly,(req,res)=>{
  const user=db.users.find(u=>u.id===req.params.userId);if(!user)return res.status(404).json({error:'Пользователь не найден'});
  const map=new Map(); for(const m of db.messages){if((m.chatType||'global')!=='private')continue;if(m.userId!==user.id&&m.recipientId!==user.id)continue;const peerId=m.userId===user.id?m.recipientId:m.userId;const peer=db.users.find(u=>u.id===peerId);if(!peer)continue;const prev=map.get(peerId)||{peer:cleanUser(peer),count:0,lastAt:'',lastText:''};prev.count++;if(!prev.lastAt||String(m.createdAt)>prev.lastAt){prev.lastAt=m.createdAt;prev.lastText=m.text||({image:'Фото',video:'Видео',audio:'Голосовое',gift:'Подарок'}[m.type]||'Сообщение');}map.set(peerId,prev);}
  res.json({user:cleanUser(user),conversations:[...map.values()].sort((a,b)=>String(b.lastAt).localeCompare(String(a.lastAt)))});
});
app.get('/api/admin/audit/messages/:a/:b',auth,adminOnly,(req,res)=>{
  const a=db.users.find(u=>u.id===req.params.a),b=db.users.find(u=>u.id===req.params.b);if(!a||!b)return res.status(404).json({error:'Пользователь не найден'});
  const messages=db.messages.filter(m=>(m.chatType||'global')==='private'&&((m.userId===a.id&&m.recipientId===b.id)||(m.userId===b.id&&m.recipientId===a.id))).slice(-500).map(m=>serializeMessage(m,req.user));
  res.json({a:cleanUser(a),b:cleanUser(b),messages});
});
app.get('/api/admin/purchases',auth,adminOnly,(req,res)=>{const purchases=db.purchases.slice().reverse().map(p=>({...p,user:cleanUser(db.users.find(u=>u.id===p.userId)||{id:null,username:'Удалён',phone:''})}));res.json({purchases,paymentPhone:PAYMENT_PHONE});});
app.post('/api/admin/purchases/:id/approve',auth,adminOnly,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});const u=db.users.find(x=>x.id===p.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});u.strawberries=(Number(u.strawberries)||0)+p.berries;p.status='approved';p.updatedAt=new Date().toISOString();p.approvedBy=req.user.id;saveDb();io.emit('user-updated',cleanUser(u));res.json({purchase:p,user:cleanUser(u)});});
app.post('/api/admin/purchases/:id/reject',auth,adminOnly,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});p.status='rejected';p.updatedAt=new Date().toISOString();saveDb();res.json({purchase:p});});


app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err instanceof multer.MulterError){
    if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Файл слишком большой. Максимум 80 МБ.'});
    return res.status(400).json({error:'Не удалось загрузить файл'});
  }
  if(err?.message==='Недопустимый тип файла')return res.status(400).json({error:err.message});
  console.error('[http]',err);
  res.status(500).json({error:'Внутренняя ошибка сервера'});
});


const onlineSockets=new Map();
io.use((socket,next)=>{try{const p=jwt.verify(socket.handshake.auth?.token,JWT_SECRET);const u=db.users.find(x=>x.id===p.id);if(!u)return next(new Error('unauthorized'));socket.user=u;next()}catch{next(new Error('unauthorized'))}});
function emitToViewers(event,m,payloadFactory){for(const s of io.sockets.sockets.values())if(canSeeMessage(m,s.user))s.emit(event,typeof payloadFactory==='function'?payloadFactory(s.user):payloadFactory);}
function addMutualContact(a,b){a.contacts||=[];b.contacts||=[];if(!a.contacts.includes(b.id))a.contacts.push(b.id);if(!b.contacts.includes(a.id))b.contacts.push(a.id);}

io.on('connection',socket=>{
  const u=socket.user; onlineSockets.set(u.id,(onlineSockets.get(u.id)||0)+1); u.online=true; saveDb(); io.emit('presence',{id:u.id,online:true}); io.emit('participants',db.users.length);
  let messageWindowStart=Date.now(),messageCount=0;
  socket.on('typing',payload=>{const isTyping=typeof payload==='object'?!!payload.isTyping:!!payload;const peerId=typeof payload==='object'?(payload.peerId||null):null;socket.broadcast.emit('typing',{userId:u.id,username:u.username,isTyping,peerId});});
  socket.on('send-message',payload=>{
    const now=Date.now(); if(now-messageWindowStart>10000){messageWindowStart=now;messageCount=0} if(++messageCount>35)return socket.emit('send-error',{error:'Слишком много сообщений. Подождите несколько секунд.'});
    const text=String(payload?.text||'').trim().slice(0,4000); const type=['text','image','video','audio','file','poll'].includes(payload?.type)?payload.type:'text'; const mediaUrl=String(payload?.mediaUrl||'');
    if(!['text','poll'].includes(type)&&!mediaUrl.startsWith('/uploads/'))return; if(type==='text'&&!text)return;
    const requestedChannelId=String(payload?.channelId||'');if(requestedChannelId)return socket.emit('send-error',{error:'Пользовательские каналы удалены в 0.1.8v'});
    let channelId=null;let recipientId=payload?.recipientId||null;
 const recipient=recipientId?db.users.find(x=>x.id===recipientId):null; if(recipientId&&!recipient)return; if(recipient){u.blocked||=[];recipient.blocked||=[];if(u.blocked.includes(recipient.id)||recipient.blocked.includes(u.id))return socket.emit('send-error',{error:'Сообщение не отправлено: один из пользователей заблокирован'});addMutualContact(u,recipient);}
    const reply=payload?.replyTo?db.messages.find(x=>x.id===payload.replyTo):null;
    let poll=null;if(type==='poll'){if(!isPremium(u))return socket.emit('send-error',{error:'Опросы доступны в Chatics Premium'});const q=String(payload?.poll?.question||text||'').trim().slice(0,180);const opts=(Array.isArray(payload?.poll?.options)?payload.poll.options:[]).map(x=>String(x||'').trim().slice(0,80)).filter(Boolean).slice(0,8);if(q.length<2||opts.length<2)return socket.emit('send-error',{error:'В опросе нужно минимум 2 варианта'});poll={question:q,options:opts.map(t=>({id:crypto.randomUUID(),text:t,voters:[]}))};}
    const m={id:crypto.randomUUID(),userId:u.id,text:type==='poll'?'':text,type,mediaUrl:['text','poll'].includes(type)?'':mediaUrl,fileName:String(payload?.fileName||'').slice(0,120),mime:String(payload?.mime||'').slice(0,80),anonymous:!!payload?.anonymous&&!recipientId&&!channelId,chatType:recipientId?'private':'global',recipientId:recipientId||null,channelId,createdAt:new Date().toISOString(),viewers:[],reactions:{},hiddenFor:[],replyTo:reply&&canSeeMessage(reply,u)?reply.id:null,pinned:false,giftId:null,poll};
    db.messages.push(m); if(db.messages.length>5000)db.messages=db.messages.slice(-5000); saveDb(); emitToViewers('message',m,viewer=>serializeMessage(m,viewer));
  });
  socket.on('view-message',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u)||m.userId===u.id)return;m.viewers||=[];if(m.viewers.includes(u.id))return;m.viewers.push(u.id);saveDb();emitToViewers('message-views',m,{id:m.id,views:m.viewers.length});});
  socket.on('react-message',payload=>{const id=payload?.id,emoji=payload?.emoji;const allowed=['❤','👍','😂','💋','👀','🤔','🤢','😎','🤡','💩'];if(!allowed.includes(emoji))return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.reactions||={};m.reactions[emoji]||=[];const i=m.reactions[emoji].indexOf(u.id);if(i>=0)m.reactions[emoji].splice(i,1);else m.reactions[emoji].push(u.id);saveDb();emitToViewers('message-reactions',m,viewer=>({id:m.id,reactions:serializeMessage(m,viewer).reactions}));});
  socket.on('delete-message-self',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.hiddenFor||=[];if(!m.hiddenFor.includes(u.id))m.hiddenFor.push(u.id);saveDb();socket.emit('message-hidden',id);});
  socket.on('delete-message-all',id=>{const i=db.messages.findIndex(x=>x.id===id);if(i<0)return;if(!u.isAdmin&&db.messages[i].userId!==u.id)return;db.messages.splice(i,1);saveDb();io.emit('message-deleted',id);});
  socket.on('pin-message',id=>{if(!u.isAdmin&&!isPremium(u))return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;const next=!m.pinned;if(next)for(const other of db.messages)if(other.id!==m.id&&sameConversation(m,other))other.pinned=false;m.pinned=next;saveDb();emitToViewers('pin-changed',m,{id:m.id,pinned:m.pinned});});
  socket.on('vote-poll',payload=>{const m=db.messages.find(x=>x.id===payload?.id);if(!m?.poll||!canSeeMessage(m,u))return;const opt=m.poll.options.find(o=>o.id===payload?.optionId);if(!opt)return;for(const o of m.poll.options)o.voters=(o.voters||[]).filter(id=>id!==u.id);opt.voters.push(u.id);saveDb();emitToViewers('poll-updated',m,viewer=>({id:m.id,poll:serializeMessage(m,viewer).poll}));});
  socket.on('disconnect',()=>{const count=Math.max(0,(onlineSockets.get(u.id)||1)-1);if(count)onlineSockets.set(u.id,count);else{onlineSockets.delete(u.id);u.online=false;saveDb();io.emit('presence',{id:u.id,online:false})}});
});

ensureAdmin().then(()=>server.listen(PORT,'0.0.0.0',()=>{
  console.log(`205chating 0.1.8v running on port ${PORT}`);
  if(IS_PROD && JWT_SECRET==='205chating-change-this-secret-in-production')console.warn('[security] Set JWT_SECRET in Railway variables before public launch.');
  if(IS_PROD)console.warn('[storage] data/db.json and uploads are local. Use persistent storage before scaling or accepting meaningful payment volume.');
}));

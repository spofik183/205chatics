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
const io = new Server(server, { maxHttpBufferSize: 45 * 1024 * 1024 });

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
const APP_VERSION = '14.0.0-beta';
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
    giftCatalog: [], maintenanceUntil: null,
    channel: { name:'205chat', avatarUrl:'', description:'Общий чат 205chating', verified:true }
  };
}
function loadDb(){
  try{
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    parsed.users ||= []; parsed.messages ||= []; parsed.gifts ||= []; parsed.purchases ||= []; parsed.supportThreads ||= {};
    parsed.giftCatalog ||= [];
    parsed.maintenanceUntil ||= null;
    // v10: базовых подарков больше нет. Рынок полностью создаёт администратор.
    parsed.giftCatalog = parsed.giftCatalog.filter(g=>!g.seed).map(g=>({id:g.id||crypto.randomUUID(),key:g.key||g.id||crypto.randomUUID(),name:String(g.name||'Подарок'),price:Math.max(1,Math.trunc(Number(g.price)||1)),image:g.image||'',type:g.type==='nft'?'nft':'gift',totalSupply:Math.max(1,Math.trunc(Number(g.totalSupply)||1)),remaining:Math.max(0,Math.trunc(Number(g.remaining ?? g.totalSupply)||0)),createdAt:g.createdAt||new Date().toISOString(),releaseAt:g.releaseAt||null,createdBy:g.createdBy||null}));
    parsed.channel ||= {name:'205chat',avatarUrl:'',description:'Общий чат 205chating',verified:true};
    parsed.channel.name='205chat'; parsed.channel.verified=true; parsed.channel.avatarUrl ||= ''; parsed.channel.description ||= 'Общий чат 205chating';
    for(const u of parsed.users){
      u.contacts ||= []; u.avatarUrl ||= ''; u.bio ||= ''; u.hidePhone = !!u.hidePhone; u.online = false; u.strawberries = Math.max(0,Number(u.strawberries)||0); u.featuredGiftId ||= null;
    }
    for(const m of parsed.messages){
      m.chatType ||= 'global'; m.recipientId ||= null; m.viewers ||= []; m.reactions ||= {}; m.hiddenFor ||= []; m.replyTo ||= null; m.pinned = !!m.pinned; m.giftId ||= null;
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
function giftSummary(id){
  const r=giftRecord(id); if(!r)return null; const def=giftDef(r.giftKey); if(!def)return null;
  return {id:r.id,giftKey:r.giftKey,name:def.name,image:def.image,price:r.price,type:def.type||'gift',serial:r.serial||null,totalSupply:def.totalSupply||null};
}
function cleanUser(u,viewer=null){
  const canSeePhone = !u.hidePhone || viewer?.id===u.id || viewer?.isAdmin;
  return {id:u.id,phone:canSeePhone?u.phone:'',phoneHidden:!!u.hidePhone,username:u.username,avatarUrl:u.avatarUrl||'',bio:u.bio||'',isAdmin:!!u.isAdmin,verified:!!u.verified,online:!!u.online,createdAt:u.createdAt,strawberries:Math.max(0,Number(u.strawberries)||0),featuredGift:giftSummary(u.featuredGiftId)};
}
function adminUser(u){ return {...cleanUser(u,{isAdmin:true}),rootAdmin:isRootAdmin(u)}; }

async function ensureAdmin(){
  let admin=db.users.find(u=>u.phone===ADMIN_PHONE||u.username===ADMIN_USERNAME);
  if(!admin){
    admin={id:crypto.randomUUID(),phone:ADMIN_PHONE,username:ADMIN_USERNAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,10),avatarUrl:'',bio:'',isAdmin:true,verified:true,online:false,contacts:[],strawberries:0,featuredGiftId:null,createdAt:new Date().toISOString()};
    db.users.push(admin);
  }else{
    admin.phone=ADMIN_PHONE; admin.username=ADMIN_USERNAME; admin.isAdmin=true; admin.verified=true; admin.contacts||=[]; admin.avatarUrl||=''; admin.bio||=''; admin.strawberries=Math.max(0,Number(admin.strawberries)||0);
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
  limits:{fileSize:45*1024*1024,files:1},
  fileFilter:(_req,file,cb)=>{
    const mime=String(file.mimetype||'').toLowerCase();
    if(mime.startsWith('image/')||mime.startsWith('video/')||mime.startsWith('audio/')||mime==='application/octet-stream')return cb(null,true);
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
  const u={id:crypto.randomUUID(),phone,username,passwordHash:await bcrypt.hash(password,10),avatarUrl:'',bio:'',isAdmin:false,verified:false,online:false,contacts:[],strawberries:0,featuredGiftId:null,createdAt:new Date().toISOString()};
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
  if(!req.file.mimetype.startsWith('image/')){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Нужно изображение'})}
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
  // square-*.webm/mp4 всегда считается видео, voice-* — аудио.
  const original=String(req.file.originalname||'').toLowerCase();
  if(original.startsWith('square-')||original.startsWith('triangle-')) type='video';
  if(original.startsWith('voice-')) type='audio';
  if(type==='file'){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Можно отправлять только фото, видео и голосовые сообщения'})}
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
  req.user.contacts||=[]; if(!req.user.contacts.includes(u.id))req.user.contacts.push(u.id); saveDb(); res.json({contact:cleanUser(u,req.user)});
});
app.delete('/api/contacts/:id',auth,(req,res)=>{ req.user.contacts=(req.user.contacts||[]).filter(id=>id!==req.params.id); saveDb(); res.json({ok:true}); });
app.delete('/api/private/:id/messages',auth,(req,res)=>{ const peer=db.users.find(u=>u.id===req.params.id); if(!peer)return res.status(404).json({error:'Пользователь не найден'}); db.messages=db.messages.filter(m=>!((m.chatType||'global')==='private'&&((m.userId===req.user.id&&m.recipientId===peer.id)||(m.userId===peer.id&&m.recipientId===req.user.id)))); saveDb(); io.to(req.user.id).emit('private-chat-cleared',{peerId:peer.id}); io.to(peer.id).emit('private-chat-cleared',{peerId:req.user.id}); res.json({ok:true}); });

function canSeeMessage(m,u){
  if((m.hiddenFor||[]).includes(u.id))return false;
  if((m.chatType||'global')==='global')return true;
  return m.userId===u.id||m.recipientId===u.id;
}
function sameConversation(a,b){
  if((a.chatType||'global')!==(b.chatType||'global'))return false;
  if((a.chatType||'global')==='global')return true;
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
    chatType:m.chatType||'global',recipientId:m.recipientId||null,views:(m.viewers||[]).length,reactions,pinned:!!m.pinned,
    gift:gift&&giftInfo?{...giftInfo,letter:gift.letter||'',sender:giftSender?cleanUser(giftSender):null}:null,
    replyTo:reply?{id:reply.id,text:(reply.text||({image:'Фото',video:'Видео',audio:'Голосовое',gift:'Подарок'}[reply.type]||'')).slice(0,90),sender:replySender?.username||'Пользователь'}:null
  };
}
app.get('/api/messages',auth,(req,res)=>{
  const peer=String(req.query.peer||''); let items=db.messages.filter(m=>canSeeMessage(m,req.user));
  if(peer)items=items.filter(m=>(m.chatType||'global')==='private'&&((m.userId===req.user.id&&m.recipientId===peer)||(m.userId===peer&&m.recipientId===req.user.id)));
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
  if(/^успешно\s*✅?$/i.test(text)){const p=db.purchases.filter(x=>x.userId===req.user.id&&x.status==='pending').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];if(p){p.status='paid';p.updatedAt=new Date().toISOString();botMessage=pushSupport(req.user.id,'bot',`Спасибо! Заявка на ${p.berries}🍓 отправлена администратору на проверку. После подтверждения клубнички появятся на балансе.`);}else botMessage=pushSupport(req.user.id,'bot','Не вижу активной заявки на пополнение. Нажми на поле сообщения → «# пополнить клубнички🍓» и сначала выбери пакет.');}
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

function utcDayKey(value){const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10)}
function shiftUtcDay(key,delta){const d=new Date(key+'T00:00:00.000Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function privateStreak(a,b){
  const days=new Map();
  for(const m of db.messages){if((m.chatType||'global')!=='private')continue;const pair=(m.userId===a&&m.recipientId===b)||(m.userId===b&&m.recipientId===a);if(!pair)continue;const key=utcDayKey(m.createdAt);if(!key)continue;if(!days.has(key))days.set(key,new Set());days.get(key).add(m.userId)}
  const active=key=>days.get(key)?.has(a)&&days.get(key)?.has(b);
  const today=utcDayKey(new Date()),yesterday=shiftUtcDay(today,-1);let cursor=active(today)?today:(active(yesterday)?yesterday:null);if(!cursor)return 0;
  let n=0;while(active(cursor)){n++;cursor=shiftUtcDay(cursor,-1)}return n;
}
app.get('/api/private/:peerId/streak',auth,(req,res)=>{const peer=db.users.find(u=>u.id===req.params.peerId);if(!peer)return res.status(404).json({error:'Пользователь не найден'});res.json({streak:privateStreak(req.user.id,peer.id)});});

// Admin gift/NFT market
app.get('/api/admin/gifts',auth,adminOnly,(_req,res)=>res.json({catalog:db.giftCatalog.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}));
app.post('/api/admin/gifts',auth,adminOnly,upload.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Загрузите изображение'});
  if(!req.file.mimetype.startsWith('image/')){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Нужно изображение'})}
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
  if(Object.prototype.hasOwnProperty.call(req.body,'releaseAt')){const raw=String(req.body.releaseAt||'').trim();if(!raw)g.releaseAt=null;else{const d=new Date(raw);if(Number.isNaN(d.getTime()))return res.status(400).json({error:'Некорректная дата выхода'});g.releaseAt=d.toISOString();}}
  saveDb();res.json({item:g});
});
app.delete('/api/admin/gifts/:id',auth,adminOnly,(req,res)=>{
  const i=db.giftCatalog.findIndex(x=>x.id===req.params.id||x.key===req.params.id);if(i<0)return res.status(404).json({error:'Подарок не найден'});
  db.giftCatalog.splice(i,1);saveDb();res.json({ok:true});
});

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
  db.users=db.users.filter(x=>x.id!==u.id);
  db.messages=db.messages.filter(m=>m.userId!==u.id&&m.recipientId!==u.id);
  db.gifts=db.gifts.filter(g=>g.receiverId!==u.id&&g.senderId!==u.id);
  db.purchases=db.purchases.filter(p=>p.userId!==u.id);
  delete db.supportThreads[u.id];
  for(const x of db.users)x.contacts=(x.contacts||[]).filter(id=>id!==u.id);
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
    if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Файл слишком большой. Максимум 45 МБ.'});
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
    const text=String(payload?.text||'').trim().slice(0,4000); const type=['text','image','video','audio'].includes(payload?.type)?payload.type:'text'; const mediaUrl=String(payload?.mediaUrl||'');
    if(type!=='text'&&!mediaUrl.startsWith('/uploads/'))return; if(type==='text'&&!text)return;
    let recipientId=payload?.recipientId||null; const recipient=recipientId?db.users.find(x=>x.id===recipientId):null; if(recipientId&&!recipient)return; if(recipient)addMutualContact(u,recipient);
    const reply=payload?.replyTo?db.messages.find(x=>x.id===payload.replyTo):null;
    const m={id:crypto.randomUUID(),userId:u.id,text,type,mediaUrl:type==='text'?'':mediaUrl,fileName:String(payload?.fileName||'').slice(0,120),mime:String(payload?.mime||'').slice(0,80),anonymous:!!payload?.anonymous&&!recipientId,chatType:recipientId?'private':'global',recipientId:recipientId||null,createdAt:new Date().toISOString(),viewers:[],reactions:{},hiddenFor:[],replyTo:reply&&canSeeMessage(reply,u)?reply.id:null,pinned:false,giftId:null};
    db.messages.push(m); if(db.messages.length>5000)db.messages=db.messages.slice(-5000); saveDb(); emitToViewers('message',m,viewer=>serializeMessage(m,viewer)); if(recipient){const streak=privateStreak(u.id,recipient.id);for(const s of io.sockets.sockets.values()){if(s.user.id===u.id)s.emit('streak-updated',{peerId:recipient.id,streak});else if(s.user.id===recipient.id)s.emit('streak-updated',{peerId:u.id,streak});}}
  });
  socket.on('view-message',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u)||m.userId===u.id)return;m.viewers||=[];if(m.viewers.includes(u.id))return;m.viewers.push(u.id);saveDb();emitToViewers('message-views',m,{id:m.id,views:m.viewers.length});});
  socket.on('react-message',payload=>{const id=payload?.id,emoji=payload?.emoji;const allowed=['❤','👍','😂','💋','👀','🤔','🤢','😎','🤡','💩'];if(!allowed.includes(emoji))return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.reactions||={};m.reactions[emoji]||=[];const i=m.reactions[emoji].indexOf(u.id);if(i>=0)m.reactions[emoji].splice(i,1);else m.reactions[emoji].push(u.id);saveDb();emitToViewers('message-reactions',m,viewer=>({id:m.id,reactions:serializeMessage(m,viewer).reactions}));});
  socket.on('delete-message-self',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.hiddenFor||=[];if(!m.hiddenFor.includes(u.id))m.hiddenFor.push(u.id);saveDb();socket.emit('message-hidden',id);});
  socket.on('delete-message-all',id=>{const i=db.messages.findIndex(x=>x.id===id);if(i<0)return;if(!u.isAdmin&&db.messages[i].userId!==u.id)return;db.messages.splice(i,1);saveDb();io.emit('message-deleted',id);});
  socket.on('pin-message',id=>{if(!u.isAdmin)return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;const next=!m.pinned;if(next)for(const other of db.messages)if(other.id!==m.id&&sameConversation(m,other))other.pinned=false;m.pinned=next;saveDb();emitToViewers('pin-changed',m,{id:m.id,pinned:m.pinned});});
  socket.on('disconnect',()=>{const count=Math.max(0,(onlineSockets.get(u.id)||1)-1);if(count)onlineSockets.set(u.id,count);else{onlineSockets.delete(u.id);u.online=false;saveDb();io.emit('presence',{id:u.id,online:false})}});
});

ensureAdmin().then(()=>server.listen(PORT,'0.0.0.0',()=>{
  console.log(`205chating v14 soft-launch running on port ${PORT}`);
  if(IS_PROD && JWT_SECRET==='205chating-change-this-secret-in-production')console.warn('[security] Set JWT_SECRET in Railway variables before public launch.');
  if(IS_PROD)console.warn('[storage] data/db.json and uploads are local. Use persistent storage before scaling or accepting meaningful payment volume.');
}));

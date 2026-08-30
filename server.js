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

const GIFT_CATALOG = [
  { key:'monkey', name:'Обезьянка', price:25, image:'/gifts/monkey.jpg' },
  { key:'dog', name:'Догги', price:35, image:'/gifts/dog.jpg' },
  { key:'beer', name:'Кружка', price:45, image:'/gifts/beer.jpg' },
  { key:'pinkbear', name:'Розовый мишка', price:60, image:'/gifts/pinkbear.jpg' },
  { key:'socks', name:'Синие носки', price:75, image:'/gifts/socks.jpg' },
  { key:'cat', name:'Котик', price:95, image:'/gifts/cat.jpg' },
  { key:'frog', name:'Лягушонок', price:120, image:'/gifts/frog.jpg' },
  { key:'liberty', name:'Свобода', price:160, image:'/gifts/liberty.jpg' },
  { key:'bear', name:'Мишка 205', price:220, image:'/gifts/bear.jpg' }
];
const PURCHASE_PACKAGES = [
  { id:'s100', berries:100, rub:49 },
  { id:'s300', berries:300, rub:119 },
  { id:'s750', berries:750, rub:239 }
];
const PAYMENT_PHONE = '+79811292091';

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultDb(){
  return {
    users: [], messages: [], gifts: [], purchases: [], supportThreads: {},
    channel: { name:'205chat', avatarUrl:'', description:'Общий чат 205chating', verified:true }
  };
}
function loadDb(){
  try{
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    parsed.users ||= []; parsed.messages ||= []; parsed.gifts ||= []; parsed.purchases ||= []; parsed.supportThreads ||= {};
    parsed.channel ||= {name:'205chat',avatarUrl:'',description:'Общий чат 205chating',verified:true};
    parsed.channel.name='205chat'; parsed.channel.verified=true; parsed.channel.avatarUrl ||= ''; parsed.channel.description ||= 'Общий чат 205chating';
    for(const u of parsed.users){
      u.contacts ||= []; u.avatarUrl ||= ''; u.bio ||= ''; u.online = false; u.strawberries = Math.max(0,Number(u.strawberries)||0); u.featuredGiftId ||= null;
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
function saveDb(){ fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(DATA_FILE,JSON.stringify(db,null,2)); }

const ADMIN_PHONE = '+77777777777';
const ADMIN_USERNAME = 'админ67';
const ADMIN_PASSWORD = '220419';
const normalizePhone = phone => String(phone||'').replace(/[^\d+]/g,'');
const normalizeUsername = username => String(username||'').trim().replace(/^@/,'');
const isRootAdmin = u => u?.phone === ADMIN_PHONE;
const giftDef = key => GIFT_CATALOG.find(g=>g.key===key) || null;
const giftRecord = id => db.gifts.find(g=>g.id===id) || null;
function giftSummary(id){
  const r=giftRecord(id); if(!r)return null; const def=giftDef(r.giftKey); if(!def)return null;
  return {id:r.id,giftKey:r.giftKey,name:def.name,image:def.image,price:r.price};
}
function cleanUser(u){
  return {id:u.id,phone:u.phone,username:u.username,avatarUrl:u.avatarUrl||'',bio:u.bio||'',isAdmin:!!u.isAdmin,verified:!!u.verified,online:!!u.online,createdAt:u.createdAt,strawberries:Math.max(0,Number(u.strawberries)||0),featuredGift:giftSummary(u.featuredGiftId)};
}
function adminUser(u){ return {...cleanUser(u),rootAdmin:isRootAdmin(u)}; }

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
const upload=multer({storage,limits:{fileSize:45*1024*1024}});

app.get('/health',(_req,res)=>res.status(200).send('ok'));

app.post('/api/register',async(req,res)=>{
  const phone=normalizePhone(req.body.phone), username=normalizeUsername(req.body.username), password=String(req.body.password||'');
  if(req.body.acceptedTerms!==true)return res.status(400).json({error:'Нужно принять пользовательское соглашение'});
  if(!/^\+7\d{10}$/.test(phone))return res.status(400).json({error:'Введите номер в формате +7XXXXXXXXXX'});
  if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа, буквы, цифры или _'});
  if(password.length<6)return res.status(400).json({error:'Пароль минимум 6 символов'});
  if(db.users.some(u=>u.phone===phone))return res.status(409).json({error:'Этот номер уже зарегистрирован'});
  if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Этот username уже занят'});
  const u={id:crypto.randomUUID(),phone,username,passwordHash:await bcrypt.hash(password,10),avatarUrl:'',bio:'',isAdmin:false,verified:false,online:false,contacts:[],strawberries:0,featuredGiftId:null,createdAt:new Date().toISOString()};
  db.users.push(u); saveDb(); io.emit('participants',db.users.length); res.json({token:tokenFor(u),user:cleanUser(u)});
});
app.post('/api/login',async(req,res)=>{
  const login=String(req.body.login||'').trim(), password=String(req.body.password||'');
  const phone=normalizePhone(login), user=normalizeUsername(login).toLowerCase();
  const u=db.users.find(x=>x.phone===phone||x.username.toLowerCase()===user);
  if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:'Неверный логин или пароль'});
  res.json({token:tokenFor(u),user:cleanUser(u)});
});

app.get('/api/me',auth,(req,res)=>res.json({user:cleanUser(req.user)}));
app.patch('/api/profile',auth,(req,res)=>{
  const username=normalizeUsername(req.body.username);
  if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа, буквы, цифры или _'});
  if(db.users.some(u=>u.id!==req.user.id&&u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Этот username уже занят'});
  req.user.username=username;
  if(Object.prototype.hasOwnProperty.call(req.body,'bio')) req.user.bio=String(req.body.bio||'').trim().slice(0,200);
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
  res.json({user:cleanUser(u),gifts});
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

app.post('/api/upload',auth,upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Файл не выбран'});
  const mime=req.file.mimetype||'';
  const type=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'file';
  if(type==='file'){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Можно отправлять только фото, видео и голосовые сообщения'})}
  res.json({url:`/uploads/${req.file.filename}`,type,mime,name:String(req.file.originalname||'').slice(0,120),size:req.file.size});
});
app.get('/api/stats',auth,(_req,res)=>res.json({participants:db.users.length}));

app.get('/api/contacts',auth,(req,res)=>{
  req.user.contacts||=[]; const list=req.user.contacts.map(id=>db.users.find(u=>u.id===id)).filter(Boolean).map(cleanUser); res.json({contacts:list});
});
app.post('/api/contacts',auth,(req,res)=>{
  const q=String(req.body.query||'').trim(); const phone=normalizePhone(q), username=normalizeUsername(q).toLowerCase();
  const u=db.users.find(x=>x.id!==req.user.id&&(x.phone===phone||x.username.toLowerCase()===username));
  if(!u)return res.status(404).json({error:'Пользователь не найден'});
  req.user.contacts||=[]; if(!req.user.contacts.includes(u.id))req.user.contacts.push(u.id); saveDb(); res.json({contact:cleanUser(u)});
});

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
app.get('/api/gifts/catalog',auth,(_req,res)=>res.json({catalog:GIFT_CATALOG}));
app.get('/api/gifts/mine',auth,(req,res)=>{
  const gifts=db.gifts.filter(g=>g.receiverId===req.user.id).slice().reverse().map(g=>({...giftSummary(g.id),letter:g.letter||'',createdAt:g.createdAt,sender:cleanUser(db.users.find(x=>x.id===g.senderId)||{id:null,username:'Пользователь',phone:''})}));
  res.json({gifts,featuredGiftId:req.user.featuredGiftId||null,balance:req.user.strawberries||0});
});
app.post('/api/gifts/send',auth,(req,res)=>{
  const recipient=db.users.find(u=>u.id===String(req.body.recipientId||'')); if(!recipient||recipient.id===req.user.id)return res.status(400).json({error:'Подарок можно отправить только собеседнику'});
  const def=giftDef(String(req.body.giftKey||'')); if(!def)return res.status(400).json({error:'Подарок не найден'});
  const letter=String(req.body.letter||'').trim().slice(0,50); req.user.strawberries=Math.max(0,Number(req.user.strawberries)||0);
  if(req.user.strawberries<def.price)return res.status(400).json({error:`Не хватает клубничек: нужно ${def.price}🍓`});
  req.user.strawberries-=def.price;
  const g={id:crypto.randomUUID(),giftKey:def.key,senderId:req.user.id,receiverId:recipient.id,letter,price:def.price,createdAt:new Date().toISOString()}; db.gifts.push(g);
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
function emitSupportUpdate(userId){ for(const s of io.sockets.sockets.values())if(s.user.id===userId||s.user.isAdmin)s.emit('support-updated',{userId}); }
app.get('/api/support/status',auth,(req,res)=>{const t=getThread(req.user.id,false);res.json({visible:!!t?.visible,hasThread:!!t,isAdmin:req.user.isAdmin});});
app.post('/api/support/open',auth,(req,res)=>{
  const existed=!!getThread(req.user.id,false); const t=getThread(req.user.id,true); t.visible=true;
  if(!existed||!t.messages.length)pushSupport(req.user.id,'bot','Здравствуйте! Я бот поддержки 205chating. Опишите проблему или жалобу одним сообщением — позже здесь ответит администратор.');
  saveDb(); emitSupportUpdate(req.user.id); res.json({ok:true});
});
app.delete('/api/support/hide',auth,(req,res)=>{const t=getThread(req.user.id,false);if(t)t.visible=false;saveDb();emitSupportUpdate(req.user.id);res.json({ok:true});});
app.get('/api/support/messages',auth,(req,res)=>{const t=getThread(req.user.id,true);res.json({messages:t.messages.map(m=>serializeSupportMessage(m,req.user,req.user))});});
app.post('/api/support/messages',auth,(req,res)=>{const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'Напишите сообщение'});const m=pushSupport(req.user.id,'user',text);saveDb();emitSupportUpdate(req.user.id);res.json({message:serializeSupportMessage(m,req.user,req.user)});});
app.get('/api/admin/support/threads',auth,adminOnly,(req,res)=>{
  const threads=Object.values(db.supportThreads).map(t=>{const u=db.users.find(x=>x.id===t.userId);const last=t.messages[t.messages.length-1];return u?{user:cleanUser(u),updatedAt:t.updatedAt||t.createdAt,lastText:last?.text||'',lastFrom:last?.from||'',count:t.messages.length}:null}).filter(Boolean).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({threads});
});
app.get('/api/admin/support/:userId/messages',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});const t=getThread(u.id,true);res.json({user:cleanUser(u),messages:t.messages.map(m=>serializeSupportMessage(m,req.user,u))});});
app.post('/api/admin/support/:userId/messages',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'Напишите ответ'});const m=pushSupport(u.id,'admin',text);saveDb();emitSupportUpdate(u.id);res.json({message:serializeSupportMessage(m,req.user,u)});});

// Strawberry purchases: manual payment verification by admin
app.get('/api/strawberries/packages',auth,(_req,res)=>res.json({packages:PURCHASE_PACKAGES,paymentPhone:PAYMENT_PHONE}));
app.post('/api/strawberries/purchase',auth,(req,res)=>{
  const pack=PURCHASE_PACKAGES.find(p=>p.id===req.body.packageId); if(!pack)return res.status(400).json({error:'Пакет не найден'});
  const existing=db.purchases.find(p=>p.userId===req.user.id&&p.packageId===pack.id&&['pending','paid'].includes(p.status)); if(existing)return res.status(409).json({error:'У вас уже есть незавершённая заявка на этот пакет'});
  const p={id:crypto.randomUUID(),userId:req.user.id,packageId:pack.id,berries:pack.berries,rub:pack.rub,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; db.purchases.push(p);
  pushSupport(req.user.id,'bot',`Заявка на ${pack.berries}🍓 создана. Переведите ${pack.rub}₽ на номер ${PAYMENT_PHONE}. После перевода нажмите «Я оплатил» — администратор проверит платёж и подтвердит начисление.`,{purchaseId:p.id});
  saveDb(); emitSupportUpdate(req.user.id); res.json({purchase:p,paymentPhone:PAYMENT_PHONE});
});
app.post('/api/strawberries/purchase/:id/paid',auth,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(p.status!=='pending')return res.status(400).json({error:'Заявка уже обработана'});p.status='paid';p.updatedAt=new Date().toISOString();pushSupport(req.user.id,'bot','Отметил заявку как оплаченную. Теперь ждём проверки администратора.',{purchaseId:p.id});saveDb();emitSupportUpdate(req.user.id);res.json({purchase:p});});
app.get('/api/strawberries/purchases/mine',auth,(req,res)=>res.json({purchases:db.purchases.filter(p=>p.userId===req.user.id).slice().reverse()}));

// Admin
app.get('/api/admin/users',auth,adminOnly,(req,res)=>res.json({users:db.users.map(adminUser)}));
app.patch('/api/admin/users/:id/verified',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});if(isRootAdmin(u))return res.status(400).json({error:'Галочка главного администратора постоянная'});u.verified=!!req.body.verified;saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.patch('/api/admin/users/:id/admin',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});if(isRootAdmin(u))return res.status(400).json({error:'Нельзя изменить роль главного администратора'});u.isAdmin=!!req.body.isAdmin;if(u.isAdmin)u.verified=true;saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.post('/api/admin/users/:id/strawberries',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});const amount=Math.trunc(Number(req.body.amount));if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>1000000)return res.status(400).json({error:'Введите количество от -1000000 до 1000000, кроме 0'});u.strawberries=Math.max(0,(Number(u.strawberries)||0)+amount);saveDb();io.emit('user-updated',cleanUser(u));res.json({user:adminUser(u)});});
app.get('/api/admin/purchases',auth,adminOnly,(req,res)=>{const purchases=db.purchases.slice().reverse().map(p=>({...p,user:cleanUser(db.users.find(u=>u.id===p.userId)||{id:null,username:'Удалён',phone:''})}));res.json({purchases,paymentPhone:PAYMENT_PHONE});});
app.post('/api/admin/purchases/:id/approve',auth,adminOnly,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});const u=db.users.find(x=>x.id===p.userId);if(!u)return res.status(404).json({error:'Пользователь не найден'});u.strawberries=(Number(u.strawberries)||0)+p.berries;p.status='approved';p.updatedAt=new Date().toISOString();p.approvedBy=req.user.id;pushSupport(u.id,'admin',`Платёж подтверждён. На ваш баланс начислено ${p.berries}🍓. Спасибо!`,{purchaseId:p.id});saveDb();io.emit('user-updated',cleanUser(u));emitSupportUpdate(u.id);res.json({purchase:p,user:cleanUser(u)});});
app.post('/api/admin/purchases/:id/reject',auth,adminOnly,(req,res)=>{const p=db.purchases.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Заявка не найдена'});if(!['pending','paid'].includes(p.status))return res.status(400).json({error:'Заявка уже обработана'});p.status='rejected';p.updatedAt=new Date().toISOString();pushSupport(p.userId,'admin','Не удалось подтвердить оплату. Проверьте сумму и номер перевода, затем напишите сюда в поддержку.',{purchaseId:p.id});saveDb();emitSupportUpdate(p.userId);res.json({purchase:p});});

const onlineSockets=new Map();
io.use((socket,next)=>{try{const p=jwt.verify(socket.handshake.auth?.token,JWT_SECRET);const u=db.users.find(x=>x.id===p.id);if(!u)return next(new Error('unauthorized'));socket.user=u;next()}catch{next(new Error('unauthorized'))}});
function emitToViewers(event,m,payloadFactory){for(const s of io.sockets.sockets.values())if(canSeeMessage(m,s.user))s.emit(event,typeof payloadFactory==='function'?payloadFactory(s.user):payloadFactory);}
function addMutualContact(a,b){a.contacts||=[];b.contacts||=[];if(!a.contacts.includes(b.id))a.contacts.push(b.id);if(!b.contacts.includes(a.id))b.contacts.push(a.id);}

io.on('connection',socket=>{
  const u=socket.user; onlineSockets.set(u.id,(onlineSockets.get(u.id)||0)+1); u.online=true; saveDb(); io.emit('presence',{id:u.id,online:true}); io.emit('participants',db.users.length);
  socket.on('typing',payload=>{const isTyping=typeof payload==='object'?!!payload.isTyping:!!payload;const peerId=typeof payload==='object'?(payload.peerId||null):null;socket.broadcast.emit('typing',{userId:u.id,username:u.username,isTyping,peerId});});
  socket.on('send-message',payload=>{
    const text=String(payload?.text||'').trim().slice(0,4000); const type=['text','image','video','audio'].includes(payload?.type)?payload.type:'text'; const mediaUrl=String(payload?.mediaUrl||'');
    if(type!=='text'&&!mediaUrl.startsWith('/uploads/'))return; if(type==='text'&&!text)return;
    let recipientId=payload?.recipientId||null; const recipient=recipientId?db.users.find(x=>x.id===recipientId):null; if(recipientId&&!recipient)return; if(recipient)addMutualContact(u,recipient);
    const reply=payload?.replyTo?db.messages.find(x=>x.id===payload.replyTo):null;
    const m={id:crypto.randomUUID(),userId:u.id,text,type,mediaUrl:type==='text'?'':mediaUrl,fileName:String(payload?.fileName||'').slice(0,120),mime:String(payload?.mime||'').slice(0,80),anonymous:!!payload?.anonymous&&!recipientId,chatType:recipientId?'private':'global',recipientId:recipientId||null,createdAt:new Date().toISOString(),viewers:[],reactions:{},hiddenFor:[],replyTo:reply&&canSeeMessage(reply,u)?reply.id:null,pinned:false,giftId:null};
    db.messages.push(m); if(db.messages.length>5000)db.messages=db.messages.slice(-5000); saveDb(); emitToViewers('message',m,viewer=>serializeMessage(m,viewer));
  });
  socket.on('view-message',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u)||m.userId===u.id)return;m.viewers||=[];if(m.viewers.includes(u.id))return;m.viewers.push(u.id);saveDb();emitToViewers('message-views',m,{id:m.id,views:m.viewers.length});});
  socket.on('react-message',payload=>{const id=payload?.id,emoji=payload?.emoji;const allowed=['❤','👍','😂','💋','👀','🤔','🤢','😎','🤡','💩'];if(!allowed.includes(emoji))return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.reactions||={};m.reactions[emoji]||=[];const i=m.reactions[emoji].indexOf(u.id);if(i>=0)m.reactions[emoji].splice(i,1);else m.reactions[emoji].push(u.id);saveDb();emitToViewers('message-reactions',m,viewer=>({id:m.id,reactions:serializeMessage(m,viewer).reactions}));});
  socket.on('delete-message-self',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.hiddenFor||=[];if(!m.hiddenFor.includes(u.id))m.hiddenFor.push(u.id);saveDb();socket.emit('message-hidden',id);});
  socket.on('delete-message-all',id=>{if(!u.isAdmin)return;const i=db.messages.findIndex(x=>x.id===id);if(i<0)return;db.messages.splice(i,1);saveDb();io.emit('message-deleted',id);});
  socket.on('pin-message',id=>{if(!u.isAdmin)return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;const next=!m.pinned;if(next)for(const other of db.messages)if(other.id!==m.id&&sameConversation(m,other))other.pinned=false;m.pinned=next;saveDb();emitToViewers('pin-changed',m,{id:m.id,pinned:m.pinned});});
  socket.on('disconnect',()=>{const count=Math.max(0,(onlineSockets.get(u.id)||1)-1);if(count)onlineSockets.set(u.id,count);else{onlineSockets.delete(u.id);u.online=false;saveDb();io.emit('presence',{id:u.id,online:false})}});
});

ensureAdmin().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`205chating v8 running on port ${PORT}`)));

const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const multer=require('multer');

const app=express(); const server=http.createServer(app); const io=new Server(server,{maxHttpBufferSize:40*1024*1024});
const PORT=process.env.PORT||3000; const JWT_SECRET=process.env.JWT_SECRET||'205chating-change-this-secret-in-production';
const DATA_DIR=path.join(__dirname,'data'); const DATA_FILE=path.join(DATA_DIR,'db.json'); const UPLOAD_DIR=path.join(DATA_DIR,'uploads'); fs.mkdirSync(UPLOAD_DIR,{recursive:true});
app.use(express.json({limit:'3mb'})); app.use('/uploads',express.static(UPLOAD_DIR)); app.use(express.static(path.join(__dirname,'public')));

function loadDb(){try{const x=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));x.users||=[];x.messages||=[];return x}catch{return {users:[],messages:[]}}}
let db=loadDb(); function save(){fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(db,null,2))}
const ADMIN_PHONE='+77777777777',ADMIN_USERNAME='админ67',ADMIN_PASSWORD='220419';
const normPhone=x=>String(x||'').replace(/[^\d+]/g,''); const normUser=x=>String(x||'').trim().replace(/^@/,'');
const cleanUser=u=>({id:u.id,phone:u.phone,username:u.username,avatarUrl:u.avatarUrl||'',isAdmin:!!u.isAdmin,verified:!!u.verified,online:!!u.online,createdAt:u.createdAt});
async function ensureAdmin(){let u=db.users.find(x=>x.phone===ADMIN_PHONE||x.username===ADMIN_USERNAME); if(!u){u={id:crypto.randomUUID(),phone:ADMIN_PHONE,username:ADMIN_USERNAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,10),avatarUrl:'',isAdmin:true,verified:true,online:false,contacts:[],createdAt:new Date().toISOString()};db.users.push(u)} else {u.isAdmin=true;u.verified=true;u.contacts||=[];if(!u.passwordHash)u.passwordHash=await bcrypt.hash(ADMIN_PASSWORD,10)} save()}
const tokenFor=u=>jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});
function auth(req,res,next){try{const raw=req.headers.authorization||'';const p=jwt.verify(raw.startsWith('Bearer ')?raw.slice(7):'',JWT_SECRET);const u=db.users.find(x=>x.id===p.id);if(!u)return res.status(401).json({error:'Сессия недействительна'});req.user=u;next()}catch{return res.status(401).json({error:'Нужно войти'})}}
const adminOnly=(req,res,next)=>req.user?.isAdmin?next():res.status(403).json({error:'Только для администратора'});

const storage=multer.diskStorage({destination:(_r,_f,cb)=>cb(null,UPLOAD_DIR),filename:(_r,f,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(f.originalname||'').slice(0,8)}`)});
const upload=multer({storage,limits:{fileSize:40*1024*1024}});
app.get('/health',(_r,res)=>res.send('ok'));

app.post('/api/register',async(req,res)=>{const phone=normPhone(req.body.phone),username=normUser(req.body.username),password=String(req.body.password||''); if(!/^\+7\d{10}$/.test(phone))return res.status(400).json({error:'Номер: +7XXXXXXXXXX'}); if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа'}); if(password.length<6)return res.status(400).json({error:'Пароль минимум 6 символов'}); if(db.users.some(u=>u.phone===phone))return res.status(409).json({error:'Этот номер уже зарегистрирован'}); if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Username занят'}); const u={id:crypto.randomUUID(),phone,username,passwordHash:await bcrypt.hash(password,10),avatarUrl:'',isAdmin:false,verified:false,online:false,contacts:[],createdAt:new Date().toISOString()};db.users.push(u);save();res.json({token:tokenFor(u),user:cleanUser(u)})});
app.post('/api/login',async(req,res)=>{const login=String(req.body.login||'').trim(),password=String(req.body.password||'');const u=db.users.find(x=>x.phone===normPhone(login)||x.username.toLowerCase()===normUser(login).toLowerCase());if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:'Неверный логин или пароль'});res.json({token:tokenFor(u),user:cleanUser(u)})});
app.get('/api/me',auth,(req,res)=>res.json({user:cleanUser(req.user)}));
app.patch('/api/profile',auth,(req,res)=>{const username=normUser(req.body.username);if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username))return res.status(400).json({error:'Username: 3–24 символа'});if(db.users.some(u=>u.id!==req.user.id&&u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Username занят'});req.user.username=username;save();io.emit('user-updated',cleanUser(req.user));res.json({user:cleanUser(req.user)})});
app.post('/api/profile/avatar',auth,upload.single('avatar'),(req,res)=>{if(!req.file||!req.file.mimetype.startsWith('image/'))return res.status(400).json({error:'Нужно изображение'});req.user.avatarUrl=`/uploads/${req.file.filename}`;save();io.emit('user-updated',cleanUser(req.user));res.json({user:cleanUser(req.user)})});
app.post('/api/upload',auth,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Файл не выбран'});const m=req.file.mimetype||'';const type=m.startsWith('image/')?'image':m.startsWith('video/')?'video':m.startsWith('audio/')?'audio':'file';if(type==='file'){fs.unlink(req.file.path,()=>{});return res.status(400).json({error:'Только фото, видео и аудио'})}res.json({url:`/uploads/${req.file.filename}`,type,mime:m,name:req.file.originalname||'',size:req.file.size})});

function canSeeMessage(m,u){if((m.hiddenFor||[]).includes(u.id))return false;if(m.chatType==='global')return true;if(m.chatType==='private')return m.userId===u.id||m.recipientId===u.id;return false}
function serializeMessage(m,viewer){const s=db.users.find(u=>u.id===m.userId);const reactions={};for(const [e,ids] of Object.entries(m.reactions||{}))if(ids.length)reactions[e]={count:ids.length,mine:ids.includes(viewer.id)};const reply=m.replyTo?db.messages.find(x=>x.id===m.replyTo):null;return {id:m.id,text:m.text||'',type:m.type||'text',mediaUrl:m.mediaUrl||'',mime:m.mime||'',createdAt:m.createdAt,mine:m.userId===viewer.id,sender:s?cleanUser(s):{id:null,username:'Удалённый пользователь'},chatType:m.chatType||'global',recipientId:m.recipientId||null,views:(m.viewers||[]).length,reactions,pinned:!!m.pinned,replyTo:reply?{id:reply.id,text:(reply.text||'').slice(0,80),sender:(db.users.find(u=>u.id===reply.userId)?.username||'Пользователь')}:null}}
app.get('/api/messages',auth,(req,res)=>{const peer=req.query.peer||'';const items=db.messages.filter(m=>canSeeMessage(m,req.user)&&((peer&&m.chatType==='private'&&(m.userId===peer||m.recipientId===peer))||(!peer&&m.chatType==='global'))).slice(-300);res.json({messages:items.map(m=>serializeMessage(m,req.user))})});
app.get('/api/contacts',auth,(req,res)=>{req.user.contacts||=[];res.json({contacts:req.user.contacts.map(id=>db.users.find(u=>u.id===id)).filter(Boolean).map(cleanUser)})});
app.post('/api/contacts',auth,(req,res)=>{const q=String(req.body.query||'').trim();const u=db.users.find(x=>x.id!==req.user.id&&(x.phone===normPhone(q)||x.username.toLowerCase()===normUser(q).toLowerCase()));if(!u)return res.status(404).json({error:'Пользователь не найден'});req.user.contacts||=[];if(!req.user.contacts.includes(u.id))req.user.contacts.push(u.id);save();res.json({contact:cleanUser(u)})});
app.get('/api/stats',auth,(_req,res)=>res.json({participants:db.users.length}));

app.get('/api/admin/users',auth,adminOnly,(req,res)=>res.json({users:db.users.map(cleanUser)}));
app.patch('/api/admin/users/:id/verified',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});u.verified=!!req.body.verified;save();io.emit('user-updated',cleanUser(u));res.json({user:cleanUser(u)})});
app.patch('/api/admin/users/:id/admin',auth,adminOnly,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Пользователь не найден'});if(u.id===req.user.id&&!req.body.isAdmin)return res.status(400).json({error:'Нельзя снять админку с себя'});u.isAdmin=!!req.body.isAdmin;save();io.emit('user-updated',cleanUser(u));res.json({user:cleanUser(u)})});

const online=new Map();
io.use((socket,next)=>{try{const p=jwt.verify(socket.handshake.auth?.token,JWT_SECRET);const u=db.users.find(x=>x.id===p.id);if(!u)return next(new Error('unauthorized'));socket.user=u;next()}catch{next(new Error('unauthorized'))}});
function emitMessage(m){for(const s of io.sockets.sockets.values())if(canSeeMessage(m,s.user))s.emit('message',serializeMessage(m,s.user))}
io.on('connection',socket=>{const u=socket.user;online.set(u.id,(online.get(u.id)||0)+1);u.online=true;save();io.emit('presence',{id:u.id,online:true});
 socket.on('typing',x=>socket.broadcast.emit('typing',{userId:u.id,username:u.username,isTyping:!!x?.isTyping,peerId:x?.peerId||null}));
 socket.on('send-message',p=>{const text=String(p?.text||'').trim().slice(0,4000);const type=['text','image','video','audio'].includes(p?.type)?p.type:'text';if(!text&&type==='text')return;let recipientId=p?.recipientId||null;if(recipientId&&!db.users.some(x=>x.id===recipientId))recipientId=null;const m={id:crypto.randomUUID(),userId:u.id,text,type,mediaUrl:String(p?.mediaUrl||''),mime:String(p?.mime||''),chatType:recipientId?'private':'global',recipientId,createdAt:new Date().toISOString(),viewers:[],reactions:{},hiddenFor:[],replyTo:p?.replyTo||null,pinned:false};db.messages.push(m);if(db.messages.length>2500)db.messages=db.messages.slice(-2500);save();emitMessage(m)});
 socket.on('view-message',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u)||m.userId===u.id)return;m.viewers||=[];if(!m.viewers.includes(u.id)){m.viewers.push(u.id);save();for(const s of io.sockets.sockets.values())if(canSeeMessage(m,s.user))s.emit('message-views',{id:m.id,views:m.viewers.length})}});
 socket.on('react-message',({id,emoji})=>{const allowed=['❤','👍','😂','💋','👀','🤔','🤢','😎','🤡','💩'];if(!allowed.includes(emoji))return;const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.reactions||={};m.reactions[emoji]||=[];const i=m.reactions[emoji].indexOf(u.id);if(i>=0)m.reactions[emoji].splice(i,1);else m.reactions[emoji].push(u.id);save();for(const s of io.sockets.sockets.values())if(canSeeMessage(m,s.user))s.emit('message-reactions',{id:m.id,reactions:serializeMessage(m,s.user).reactions})});
 socket.on('delete-message-self',id=>{const m=db.messages.find(x=>x.id===id);if(!m||!canSeeMessage(m,u))return;m.hiddenFor||=[];if(!m.hiddenFor.includes(u.id))m.hiddenFor.push(u.id);save();socket.emit('message-hidden',id)});
 socket.on('delete-message-all',id=>{const i=db.messages.findIndex(x=>x.id===id);if(i<0)return;const m=db.messages[i];if(m.userId!==u.id&&!u.isAdmin)return;db.messages.splice(i,1);save();io.emit('message-deleted',id)});
 socket.on('pin-message',id=>{if(!u.isAdmin)return;const m=db.messages.find(x=>x.id===id);if(!m)return;m.pinned=!m.pinned;save();io.emit('message-pinned',{id,pinned:m.pinned})});
 socket.on('disconnect',()=>{const n=Math.max(0,(online.get(u.id)||1)-1);if(n)online.set(u.id,n);else{online.delete(u.id);u.online=false;save();io.emit('presence',{id:u.id,online:false})}})
});
ensureAdmin().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`205chating v3 running on port ${PORT}`)));

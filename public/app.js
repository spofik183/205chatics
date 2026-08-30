const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const REACTIONS = ['❤','👍','😂','💋','👀','🤔','🤢','😎','🤡','💩'];

let token = localStorage.getItem('205token');
let me = null;
let socket = null;
let typingTimer = null;
let pendingMedia = null;
let pendingAvatarFile = null;
let currentPeer = null;
let currentPeerUser = null;
let contacts = [];
let contactSearch = "";
let adminUsersCache = [];
let auditSelectedUser = null;
let replyTo = null;
let recordMode = 'voice';
let mediaRecorder = null;
let recordChunks = [];
let recordStream = null;
let recordTimer = null;
let recordStarted = 0;
let recordCanceled = false;
let observer = null;
let channel = {name:'205chat',avatarUrl:'',description:'Общий чат 205chating',verified:true};
let supportMode = null; // null | user | inbox | admin
let supportUserId = null;
let supportUser = null;
let supportVisible = false;
let giftCatalog = [];
let selectedGiftKey = null;
let myGifts = [];
let myPurchases = [];

const I18N = {
  ru: {
    'auth.subtitle':'Общий чат без лишнего шума.','auth.login':'Вход','auth.register':'Регистрация','auth.usernameOrPhone':'Username или номер телефона','auth.password':'Пароль','auth.phone':'Номер телефона','auth.submitLogin':'Войти','auth.submitRegister':'Создать аккаунт',
    'common.search':'Поиск','common.logout':'Выйти','common.cancel':'Отмена','common.save':'Сохранить','chat.global':'Общий чат','chat.message':'Сообщение','chat.recording':'Запись голосового…','chat.pinned':'Закреплённое сообщение','chat.replying':'Ответ',
    'settings.title':'Настройки','settings.subtitle':'Внешний вид и язык','settings.theme':'Тема','settings.themeHint':'Светлая или тёмная','settings.dark':'Тёмная','settings.light':'Светлая','settings.language':'Язык',
    'profile.title':'Профиль','profile.subtitle':'Данные аккаунта','profile.accounts':'Аккаунты','profile.addAccount':'+ Добавить аккаунт','profile.addHint':'Войдите в существующий аккаунт','profile.switch':'Переключить','profile.current':'Сейчас',
    'photo.title':'Проверь фото','photo.subtitle':'Оно будет отображаться в профиле','photo.good':'Выглядит хорошо','photo.new':'Выбрать другое фото',
    'contacts.title':'Личные сообщения','contacts.add':'Добавить контакт','contacts.hint':'Введите номер телефона или @username','contacts.query':'Номер или username','contacts.addButton':'Добавить',
    'admin.title':'Панель администратора','admin.subtitle':'Пользователи 205chating','admin.passwordNotice':'Пароли не отображаются: сервер хранит только защищённые bcrypt-хеши.','admin.user':'Пользователь','admin.phone':'Телефон','admin.status':'Статус','admin.verified':'Галочка','admin.role':'Роль'
  },
  en: {
    'auth.subtitle':'A shared chat without the noise.','auth.login':'Log in','auth.register':'Register','auth.usernameOrPhone':'Username or telephone number','auth.password':'Password','auth.phone':'Telephone number','auth.submitLogin':'Log in','auth.submitRegister':'Create account',
    'common.search':'Search','common.logout':'Log out','common.cancel':'Cancel','common.save':'Save','chat.global':'Global chat','chat.message':'Message','chat.recording':'Recording voice…','chat.pinned':'Pinned message','chat.replying':'Reply',
    'settings.title':'Settings','settings.subtitle':'Appearance and language','settings.theme':'Theme','settings.themeHint':'Light or dark','settings.dark':'Dark','settings.light':'Light','settings.language':'Language',
    'profile.title':'Profile','profile.subtitle':'Account details','profile.accounts':'Accounts','profile.addAccount':'+ Add account','profile.addHint':'Log in to an existing account','profile.switch':'Switch','profile.current':'Current',
    'photo.title':'Review Your Photo','photo.subtitle':'This will appear in your profile','photo.good':'Looks Good','photo.new':'Choose another photo',
    'contacts.title':'Direct messages','contacts.add':'Add contact','contacts.hint':'Enter telephone number or @username','contacts.query':'Number or username','contacts.addButton':'Add',
    'admin.title':'Admin panel','admin.subtitle':'205chating users','admin.passwordNotice':'Passwords are not shown: the server stores only protected bcrypt hashes.','admin.user':'User','admin.phone':'Phone','admin.status':'Status','admin.verified':'Verified','admin.role':'Role'
  }
};
let lang = localStorage.getItem('205lang') || 'ru';
let theme = localStorage.getItem('205theme') || 'dark';

function t(k){ return I18N[lang]?.[k] || I18N.ru[k] || k; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function initials(u){ return String(u?.username || '205').slice(0,2).toUpperCase(); }
function badge(u){ return (u?.verified || u?.isAdmin) ? '<span class="check">✓</span>' : ''; }
function toast(text){ const e=$('#toast'); e.textContent=text; e.classList.add('show'); clearTimeout(e._timer); e._timer=setTimeout(()=>e.classList.remove('show'),2400); }
function setAvatar(el,user){ if(!el)return; el.textContent=user?.avatarUrl?'':initials(user); el.style.backgroundImage=user?.avatarUrl?`url("${user.avatarUrl}")`:''; }
function formatTime(iso){ try{return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch{return ''} }
function compactText(m){ if(m.text)return m.text.slice(0,80); if(m.type==='image')return lang==='ru'?'Фото':'Photo'; if(m.type==='video')return lang==='ru'?'Видео':'Video'; if(m.type==='audio')return lang==='ru'?'Голосовое сообщение':'Voice message'; return ''; }

function applyPrefs(){
  document.documentElement.dataset.theme=theme;
  document.documentElement.lang=lang;
  $$('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  $$('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder));
  $('#themeDark')?.classList.toggle('active',theme==='dark');
  $('#themeLight')?.classList.toggle('active',theme==='light');
  $('#langRu')?.classList.toggle('active',lang==='ru');
  $('#langEn')?.classList.toggle('active',lang==='en');
  updateChatHeader();
  renderAccounts();
}

async function api(url,opt={}){
  const headers={...(token?{Authorization:`Bearer ${token}`}:{}) ,...(opt.headers||{})};
  if(!(opt.body instanceof FormData))headers['Content-Type']='application/json';
  const r=await fetch(url,{...opt,headers});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}

function accounts(){ try{return JSON.parse(localStorage.getItem('205accounts')||'[]')}catch{return[]} }
function saveAccounts(a){ localStorage.setItem('205accounts',JSON.stringify(a.slice(0,8))); }
function rememberAccount(user,newToken){ let a=accounts().filter(x=>x.id!==user.id); a.unshift({id:user.id,username:user.username,phone:user.phone,avatarUrl:user.avatarUrl||'',token:newToken}); saveAccounts(a); }
function setSession(newToken,user){ token=newToken; me=user; localStorage.setItem('205token',newToken); rememberAccount(user,newToken); }
function clearSession(){ localStorage.removeItem('205token'); location.reload(); }

$$('.auth-tab').forEach(b=>b.onclick=()=>{
  $$('.auth-tab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  $$('.auth-form').forEach(x=>x.classList.remove('active'));
  $('#'+b.dataset.tab+'Form').classList.add('active');
});
$('#registerForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=await api('/api/register',{method:'POST',body:JSON.stringify({phone:$('#phone').value,username:$('#username').value,password:$('#password').value,acceptedTerms:$('#termsAccept').checked})}); setSession(d.token,d.user); await startApp(); }catch(err){toast(err.message)} };
$('#loginForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#login').value,password:$('#loginPassword').value})}); setSession(d.token,d.user); await startApp(); }catch(err){toast(err.message)} };
$('#logout').onclick=clearSession;

function syncMeUI(){
  if(!me)return;
  $('#meName').innerHTML='@'+escapeHtml(me.username)+badge(me);
  $('#mePhone').textContent=me.phone;
  $('#profileName').innerHTML='@'+escapeHtml(me.username)+badge(me);
  $('#profilePhone').textContent=me.phone;
  $('#profileUsername').value=me.username;
  $('#profileBio').value=me.bio||''; $('#bioCount').textContent=String((me.bio||'').length);
  setAvatar($('#meAvatar'),me); setAvatar($('#mobileProfile'),me); setAvatar($('#avatarButton'),me);
  $('#adminBtn').classList.toggle('hidden',!me.isAdmin);
  $('#sideAdmin')?.classList.toggle('hidden',!me.isAdmin);
  rememberAccount(me,token);
  renderAccounts();
}

function updateChatHeader(participantCount){
  if(currentPeer && currentPeerUser){
    $('#chatTitle').innerHTML='@'+escapeHtml(currentPeerUser.username)+badge(currentPeerUser);
    setAvatar($('#chatHeaderAvatar'),currentPeerUser);
    $('#chatSubtitle').textContent=currentPeerUser.online?(lang==='ru'?'в сети':'online'):(lang==='ru'?'был(а) недавно':'last seen recently');
    $('#chatSubtitle').classList.toggle('online-status',!!currentPeerUser.online);
  }else{
    $('#chatTitle').innerHTML='205chat <span class="check orange-check">✓</span>';
    $('#chatSubtitle').classList.remove('online-status');
    setAvatar($('#chatHeaderAvatar'),{username:'205',avatarUrl:channel.avatarUrl||''});
    setAvatar($('#channelAvatarSide'),{username:'205',avatarUrl:channel.avatarUrl||''});
    const n=participantCount ?? Number($('#chatSubtitle').dataset.count||0);
    $('#chatSubtitle').dataset.count=n;
    $('#chatSubtitle').textContent=n?`${n} ${lang==='ru'?'участников':'members'}`:(lang==='ru'?'общий чат':'global chat');
  }
}

async function refreshStats(){ try{const d=await api('/api/stats'); updateChatHeader(d.participants); $('#channelMembers').textContent=`${d.participants} ${lang==='ru'?'участников':'members'}`;}catch{} }
async function loadChannel(){ try{const d=await api('/api/channel'); channel=d.channel||channel; $('#channelDescription').value=channel.description||''; updateChatHeader();}catch{} }

function contactRow(u){
  const b=document.createElement('button'); b.className='contact-item'+(currentPeer===u.id?' active':''); b.dataset.peer=u.id;
  const av=document.createElement('div'); av.className='avatar'; setAvatar(av,u);
  const copy=document.createElement('div'); copy.className='contact-copy';
  copy.innerHTML=`<b>@${escapeHtml(u.username)}${badge(u)}</b><span>${escapeHtml(u.phone||'')}</span>`;
  av.onclick=e=>{e.stopPropagation();openUserProfile(u)}; b.append(av,copy); b.onclick=()=>openPeer(u); return b;
}
function renderContacts(){ const box=$('#contactsList'); box.innerHTML=''; contacts.forEach(u=>box.appendChild(contactRow(u))); }
async function loadContacts(){ try{ const d=await api('/api/contacts'); contacts=d.contacts||[]; if(currentPeer)currentPeerUser=contacts.find(x=>x.id===currentPeer)||currentPeerUser; renderContacts(); updateChatHeader(); }catch(err){toast(err.message)} }
async function openPeer(u){ currentPeer=u.id; currentPeerUser=u; replyTo=null; clearReply(); $('#sidebar').classList.remove('mobile-open'); $('#globalChat').classList.remove('active'); renderContacts(); updateChatHeader(); await loadMessages(); }
$('#globalChat').onclick=async()=>{ currentPeer=null; currentPeerUser=null; replyTo=null; clearReply(); $('#globalChat').classList.add('active'); $('#sidebar').classList.remove('mobile-open'); renderContacts(); await refreshStats(); await loadMessages(); };
$('#addContactBtn').onclick=()=>openModal('contactModal');
$('#contactForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=await api('/api/contacts',{method:'POST',body:JSON.stringify({query:$('#contactQuery').value.trim()})}); $('#contactQuery').value=''; closeModal('contactModal'); await loadContacts(); await openPeer(d.contact); toast(lang==='ru'?'Контакт добавлен':'Contact added'); }catch(err){toast(err.message)} };

function replyMarkup(m){ if(!m.replyTo)return ''; return `<div class="reply-preview"><b>@${escapeHtml(m.replyTo.sender||'user')}</b>${escapeHtml(m.replyTo.text||'')}</div>`; }
function mediaMarkup(m){
  if(m.type==='image')return `<img class="media-image" src="${escapeHtml(m.mediaUrl)}" alt="image">`;
  if(m.type==='video')return `<video class="media-video" src="${escapeHtml(m.mediaUrl)}" controls playsinline preload="metadata"></video>`;
  if(m.type==='audio')return `<audio class="media-audio" src="${escapeHtml(m.mediaUrl)}" controls preload="metadata"></audio>`;
  return '';
}
function reactionsMarkup(m){
  const entries=Object.entries(m.reactions||{}).filter(([,x])=>x?.count>0);
  if(!entries.length)return '';
  return `<div class="reactions">${entries.map(([emoji,x])=>`<button class="reaction-chip ${x.mine?'mine':''}" data-emoji="${emoji}">${emoji}${x.count}</button>`).join('')}</div>`;
}
function renderMessage(m,{append=true}={}){
  if(currentPeer){
    const belongs=m.chatType==='private' && (m.sender?.id===currentPeer || m.recipientId===currentPeer || (m.mine&&m.recipientId===currentPeer));
    if(!belongs)return null;
  }else if(m.chatType==='private')return null;

  const existing=document.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
  if(existing)existing.remove();
  const row=document.createElement('div'); row.className='msg'+(m.mine?' mine':''); row.dataset.id=m.id;
  const av=document.createElement('button'); av.className='avatar msg-avatar avatar-button'; setAvatar(av,m.sender); if(m.sender?.id)av.onclick=()=>openUserProfile(m.sender);
  const bubble=document.createElement('div'); bubble.className='bubble';
  const body=mediaMarkup(m)+(m.text?`<div class="text${m.type!=='text'?' caption':''}">${escapeHtml(m.text)}</div>`:'');
  bubble.innerHTML=`<button class="name name-button">@${escapeHtml(m.sender?.username||'Пользователь')}${badge(m.sender)}</button>${replyMarkup(m)}${body}${m.anonymousRealSender?`<div class="anon-real">@${escapeHtml(m.anonymousRealSender.username)} · ${escapeHtml(m.anonymousRealSender.phone)}</div>`:''}${reactionsMarkup(m)}<div class="message-meta"><span>${formatTime(m.createdAt)}</span>${currentPeer?'':`<span class="message-views"><span class="eye-icon">◉</span><span class="view-count">${m.views||0}</span></span>`}<button class="more-btn" aria-label="More">⋯</button></div>`;
  bubble.querySelector('.more-btn').onclick=e=>openMessageMenu(e.currentTarget,m);
  const nameBtn=bubble.querySelector('.name-button'); if(nameBtn&&m.sender?.id)nameBtn.onclick=()=>openUserProfile(m.sender);
  bubble.querySelectorAll('.reaction-chip').forEach(btn=>btn.onclick=()=>socket?.emit('react-message',{id:m.id,emoji:btn.dataset.emoji}));
  row.append(av,bubble);
  if(append)$('#messages').appendChild(row);
  observeMessage(row,m);
  if(!currentPeer)$('#lastPreview').textContent=`${m.sender?.username||''}: ${compactText(m)}`.slice(0,44);
  return row;
}

function updatePinned(messages){
  const pin=[...messages].reverse().find(m=>m.pinned);
  if(!pin){$('#pinnedBar').classList.add('hidden');return;}
  $('#pinnedText').textContent=`@${pin.sender?.username||''}: ${compactText(pin)}`;
  $('#pinnedBar').classList.remove('hidden');
}

async function loadMessages(){
  try{
    const d=await api('/api/messages'+(currentPeer?`?peer=${encodeURIComponent(currentPeer)}`:''));
    $('#messages').innerHTML='';
    (d.messages||[]).forEach(m=>renderMessage(m));
    updatePinned(d.messages||[]);
    requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight});
  }catch(err){toast(err.message)}
}

function observeMessage(row,m){
  observer ||= new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting && entry.intersectionRatio>=.55){ const id=entry.target.dataset.id; socket?.emit('view-message',id); observer.unobserve(entry.target); }
    });
  },{root:$('#messages'),threshold:[.55]});
  if(!m.mine)observer.observe(row);
}

function closeFloating(){ $('#messageMenu').classList.add('hidden'); $('#reactionPicker').classList.add('hidden'); }
function placeFloating(el,anchor){
  el.classList.remove('hidden');
  const r=anchor.getBoundingClientRect(); const w=el.offsetWidth||220; const h=el.offsetHeight||160;
  el.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';
  el.style.top=Math.max(8,Math.min(innerHeight-h-8,r.bottom+5))+'px';
}
async function saveMedia(m){ try{ const r=await fetch(m.mediaUrl); const b=await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=m.fileName||(`205chating-${m.type}-${Date.now()}.${m.type==='image'?'jpg':'webm'}`); document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }catch(e){ toast('Не удалось сохранить файл'); } }
function openMessageMenu(anchor,m){
  closeFloating();
  const menu=$('#messageMenu');
  const items=[
    {label:lang==='ru'?'Ответить':'Reply',run:()=>setReply(m)},
    {label:lang==='ru'?'Поставить реакцию':'React',run:()=>openReactionPicker(anchor,m)},
    {label:lang==='ru'?'Удалить у себя':'Delete for me',danger:true,run:()=>socket?.emit('delete-message-self',m.id)}
  ];
  if(['image','video'].includes(m.type)&&m.mediaUrl){ items.splice(2,0,{label:lang==='ru'?'Сохранить':'Save',run:()=>saveMedia(m)}); }
  if(m.mine||me?.isAdmin) items.push({label:lang==='ru'?'Удалить у всех':'Delete for everyone',danger:true,run:()=>socket?.emit('delete-message-all',m.id)});
  if(me?.isAdmin){ items.push({label:m.pinned?(lang==='ru'?'Открепить':'Unpin'):(lang==='ru'?'Закрепить':'Pin'),run:()=>socket?.emit('pin-message',m.id)}); }
  menu.innerHTML='';
  items.forEach(x=>{ const b=document.createElement('button'); b.textContent=x.label; if(x.danger)b.classList.add('danger'); b.onclick=()=>{closeFloating();x.run()}; menu.appendChild(b); });
  placeFloating(menu,anchor);
}
function openReactionPicker(anchor,m){
  const picker=$('#reactionPicker'); picker.innerHTML='';
  REACTIONS.forEach(emoji=>{ const b=document.createElement('button'); b.textContent=emoji; b.onclick=()=>{socket?.emit('react-message',{id:m.id,emoji});closeFloating()}; picker.appendChild(b); });
  placeFloating(picker,anchor);
}
document.addEventListener('click',e=>{ if(!e.target.closest('.message-menu')&&!e.target.closest('.reaction-picker')&&!e.target.closest('.more-btn'))closeFloating(); });

function setReply(m){ replyTo={id:m.id,text:compactText(m),sender:m.sender?.username||''}; $('#replyText').textContent=`@${replyTo.sender}: ${replyTo.text}`; $('#replyBar').classList.remove('hidden'); $('#messageInput').focus(); }
function clearReply(){ replyTo=null; $('#replyBar').classList.add('hidden'); $('#replyText').textContent=''; }
$('#cancelReply').onclick=clearReply;

async function uploadFile(file){ const fd=new FormData(); fd.append('file',file,file.name||'recording.webm'); return api('/api/upload',{method:'POST',body:fd}); }
function clearPendingMedia(){ pendingMedia=null; $('#uploadPreview').classList.add('hidden'); $('#uploadPreview').innerHTML=''; $('#mediaInput').value=''; }
function showPendingMedia(data,file){
  pendingMedia=data; const p=$('#uploadPreview'); let visual='';
  const local=URL.createObjectURL(file);
  if(data.type==='image')visual=`<img src="${local}">`;
  if(data.type==='video')visual=`<video src="${local}" muted></video>`;
  p.innerHTML=`${visual}<span>${escapeHtml(file.name||data.name||data.type)}</span><button class="text-btn" id="removePending">×</button>`;
  p.classList.remove('hidden'); $('#removePending').onclick=clearPendingMedia;
}
$('#attachBtn').onclick=()=>$('#mediaInput').click();
$('#mediaInput').onchange=async()=>{ const file=$('#mediaInput').files[0]; if(!file)return; try{toast(lang==='ru'?'Загрузка…':'Uploading…'); const data=await uploadFile(file); showPendingMedia(data,file);}catch(err){toast(err.message);clearPendingMedia()} };

function send(){
  if(mediaRecorder?.state==='recording'){ stopRecording(true); return; }
  const text=$('#messageInput').value.trim();
  if(!socket?.connected)return toast(lang==='ru'?'Нет соединения':'No connection');
  if(!text&&!pendingMedia)return;
  const payload={text,recipientId:currentPeer||null,replyTo:replyTo?.id||null};
  if(pendingMedia)Object.assign(payload,{type:pendingMedia.type,mediaUrl:pendingMedia.url,fileName:pendingMedia.name,mime:pendingMedia.mime}); else payload.type='text';
  socket.emit('send-message',payload);
  $('#messageInput').value=''; clearPendingMedia(); clearReply(); socket.emit('typing',{isTyping:false,peerId:currentPeer||null});
}
$('#send').onclick=send;
$('#messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
$('#messageInput').oninput=()=>{ if(!socket)return; socket.emit('typing',{isTyping:true,peerId:currentPeer||null}); clearTimeout(typingTimer); typingTimer=setTimeout(()=>socket.emit('typing',{isTyping:false,peerId:currentPeer||null}),850); };

function setRecordMode(mode){ if(mediaRecorder?.state==='recording')return; recordMode=mode; $('#modeVoice').classList.toggle('active',mode==='voice'); $('#modeVideo').classList.toggle('active',mode==='video'); $('#recordBtn').title=mode==='voice'?'Режим: голосовое':'Режим: видео-треугольник'; $('#recordBtn').setAttribute('data-mode-label',mode==='voice'?'Голос':'Видео'); }
$('#modeVoice').onclick=()=>setRecordMode('voice'); $('#modeVideo').onclick=()=>setRecordMode('video');

function updateRecordClock(){
  const elapsed=Math.max(0,Date.now()-recordStarted);
  const sec=Math.floor(elapsed/1000);
  const text=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  $('#recordTime').textContent=text;
  if(recordMode==='video'){
    const progress=Math.min(1,elapsed/59000);
    $('#videoSquareFrame')?.style.setProperty('--record-progress',`${progress*360}deg`);
    if(elapsed>=59000)stopRecording(true);
  }
}
async function startRecording(){
  if(mediaRecorder?.state==='recording')return stopRecording(true);
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)return toast(lang==='ru'?'Браузер не поддерживает запись':'Recording is not supported');
  try{
    recordCanceled=false; recordChunks=[];
    recordStream=await navigator.mediaDevices.getUserMedia(recordMode==='video'?{audio:true,video:{facingMode:'user',width:{ideal:720},height:{ideal:720}}}:{audio:true});
    let options={};
    const preferred=recordMode==='video'?['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    const mime=preferred.find(x=>MediaRecorder.isTypeSupported?.(x)); if(mime)options.mimeType=mime;
    mediaRecorder=new MediaRecorder(recordStream,options);
    mediaRecorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data)};
    mediaRecorder.onerror=()=>toast(lang==='ru'?'Ошибка записи':'Recording error');
    mediaRecorder.onstop=finishRecording;
    mediaRecorder.start(250); recordStarted=Date.now(); recordTimer=setInterval(updateRecordClock,250); updateRecordClock();
    $('#recordBtn').textContent='●'; $('#recordBtn').classList.add('recording'); $('#recordBtn').disabled=true;
    if(recordMode==='voice'){
      $('#recordLabel').textContent=lang==='ru'?'Запись голосового…':'Recording voice…'; $('#recordingBar').classList.remove('hidden');
    }else{
      $('#videoSquareFrame')?.style.setProperty('--record-progress','0deg'); $('#cameraPreview').srcObject=recordStream; $('#videoRecorder').classList.remove('hidden'); document.body.classList.add('video-recording');
    }
  }catch(err){ console.error(err); toast(lang==='ru'?'Разреши доступ к микрофону/камере':'Allow microphone/camera access'); stopTracks(); }
}
function stopTracks(){ if(recordStream){recordStream.getTracks().forEach(t=>t.stop());recordStream=null} $('#cameraPreview').srcObject=null; }
function stopRecording(sendIt){
  if(mediaRecorder?.state!=='recording')return;
  recordCanceled=!sendIt;
  try{mediaRecorder.requestData?.()}catch{}
  try{mediaRecorder.stop()}catch(err){console.error(err);toast('Не удалось завершить запись');stopTracks();mediaRecorder=null;}
}
async function finishRecording(){
  clearInterval(recordTimer); recordTimer=null;
  $('#recordingBar').classList.add('hidden'); $('#videoRecorder').classList.add('hidden'); document.body.classList.remove('video-recording'); $('#recordBtn').textContent='●'; $('#recordBtn').classList.remove('recording'); $('#recordBtn').disabled=false;
  const wasMode=recordMode; const chunks=[...recordChunks]; const mime=mediaRecorder?.mimeType||(wasMode==='video'?'video/webm':'audio/webm');
  stopTracks(); mediaRecorder=null; recordChunks=[];
  if(recordCanceled||!chunks.length){recordCanceled=false;return;}
  try{
    toast(lang==='ru'?'Отправка записи…':'Sending recording…');
    const blob=new Blob(chunks,{type:mime}); if(!blob.size)throw new Error('Запись получилась пустой — попробуй ещё раз'); const ext=mime.includes('mp4')?'mp4':mime.includes('quicktime')?'mov':'webm'; const file=new File([blob],`${wasMode==='video'?'square':'voice'}-${Date.now()}.${ext}`,{type:mime});
    const up=await uploadFile(file);
    if(!socket?.connected)throw new Error('Нет соединения с сервером');
    socket.emit('send-message',{type:wasMode==='video'?'video':'audio',mediaUrl:up.url,fileName:up.name,mime:up.mime||mime,recipientId:currentPeer||null,replyTo:replyTo?.id||null});
    clearReply(); toast(wasMode==='video'?'Видео-треугольник отправлен':'Голосовое отправлено');
  }catch(err){toast(err.message)}
}
$('#recordBtn').onclick=()=>{ if(mediaRecorder?.state==='recording')return; startRecording(); };
$('#cancelRecord').onclick=()=>stopRecording(false); $('#cancelVideo').onclick=()=>stopRecording(false);

function openModal(id){$('#'+id)?.classList.remove('hidden')}
function closeModal(id){$('#'+id)?.classList.add('hidden')}
$$('.modal-close').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.add('hidden')}));
function openSettingsPage(){ $('#settingsPage').classList.remove('hidden'); $('#sidebar').classList.remove('mobile-open'); }
function closeSettingsPage(){ $('#settingsPage').classList.add('hidden'); }
$('#closeSettingsPage').onclick=closeSettingsPage;
$('#sideSettings').onclick=openSettingsPage;
$('#sideProfile').onclick=()=>{syncMeUI();openModal('profileModal');$('#sideMenu').classList.add('hidden')};
$('#sideAddContact').onclick=()=>{openModal('contactModal');$('#sideMenu').classList.add('hidden')};
$('#sideMenuBtn').onclick=e=>{e.stopPropagation();$('#sideMenu').classList.toggle('hidden')};
document.addEventListener('click',e=>{if(!e.target.closest('#sideMenu')&&!e.target.closest('#sideMenuBtn'))$('#sideMenu').classList.add('hidden')});
$('#mobileProfile').onclick=()=>{syncMeUI();openModal('profileModal')};
$('#mobileChats').onclick=()=>$('#sidebar').classList.toggle('mobile-open');
$('#themeDark').onclick=()=>{theme='dark';localStorage.setItem('205theme',theme);applyPrefs()};
$('#themeLight').onclick=()=>{theme='light';localStorage.setItem('205theme',theme);applyPrefs()};
$('#langRu').onclick=()=>{lang='ru';localStorage.setItem('205lang',lang);applyPrefs()};
$('#langEn').onclick=()=>{lang='en';localStorage.setItem('205lang',lang);applyPrefs()};

$('#saveUsername').onclick=async()=>{try{const d=await api('/api/profile',{method:'PATCH',body:JSON.stringify({username:$('#profileUsername').value,bio:$('#profileBio').value})});me=d.user;syncMeUI();await loadContacts();toast(lang==='ru'?'Username обновлён':'Username updated')}catch(err){toast(err.message)}};
$('#profileBio').oninput=()=>$('#bioCount').textContent=String($('#profileBio').value.length);
$('#avatarButton').onclick=()=>$('#avatarInput').click();
$('#avatarInput').onchange=()=>{const file=$('#avatarInput').files[0];if(!file)return;pendingAvatarFile=file;$('#avatarPreviewImg').src=URL.createObjectURL(file);closeModal('profileModal');openModal('avatarReview')};
$('#chooseAnotherAvatar').onclick=()=>$('#avatarInput').click();
$('#confirmAvatar').onclick=async()=>{if(!pendingAvatarFile)return;try{const fd=new FormData();fd.append('avatar',pendingAvatarFile);const d=await api('/api/profile/avatar',{method:'POST',body:fd});me=d.user;syncMeUI();pendingAvatarFile=null;closeModal('avatarReview');openModal('profileModal');toast(lang==='ru'?'Фото профиля обновлено':'Profile photo updated')}catch(err){toast(err.message)}};

function renderAccounts(){
  const box=$('#accountList'); if(!box)return; box.innerHTML='';
  accounts().forEach(acc=>{ const row=document.createElement('div');row.className='account-row';const av=document.createElement('div');av.className='avatar';setAvatar(av,acc);const copy=document.createElement('div');copy.className='account-copy';copy.innerHTML=`<b>@${escapeHtml(acc.username)}</b><span>${escapeHtml(acc.phone||'')}</span>`;const b=document.createElement('button');b.className='account-switch';const current=me?.id===acc.id;b.textContent=current?t('profile.current'):t('profile.switch');b.disabled=current;b.onclick=()=>switchAccount(acc);row.append(av,copy,b);box.appendChild(row); });
}
async function switchAccount(acc){
  try{token=acc.token;localStorage.setItem('205token',token);const d=await api('/api/me');me=d.user;rememberAccount(me,token);currentPeer=null;currentPeerUser=null;syncMeUI();closeModal('profileModal');await loadContacts();await refreshStats();await loadMessages();connect();}
  catch{saveAccounts(accounts().filter(x=>x.id!==acc.id));renderAccounts();toast(lang==='ru'?'Сессия аккаунта истекла':'Account session expired')}
}
$('#addAccount').onclick=()=>openModal('accountModal');
$('#settingsAddAccount').onclick=()=>openModal('accountModal');
$('#accountLoginForm').onsubmit=async e=>{e.preventDefault();const oldToken=token,oldMe=me;try{token=null;const d=await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#accountLogin').value,password:$('#accountPassword').value})});token=oldToken;me=oldMe;rememberAccount(d.user,d.token);closeModal('accountModal');renderAccounts();toast(lang==='ru'?'Аккаунт добавлен':'Account added')}catch(err){token=oldToken;me=oldMe;toast(err.message)}};


async function openUserProfile(user){
  try{
    const d=user?.id?await api('/api/users/'+encodeURIComponent(user.id)):{user:me}; const u=d.user;
    setAvatar($('#viewUserAvatar'),u); $('#viewUserName').innerHTML='@'+escapeHtml(u.username)+badge(u); $('#viewUserPhone').textContent=u.phone||''; $('#viewUserBio').textContent=u.bio||'—';
    openModal('userProfileModal');
  }catch(err){toast(err.message)}
}
async function openChatProfile(){
  if(currentPeer&&currentPeerUser)return openUserProfile(currentPeerUser);
  await loadChannel(); $('#channelAdminControls').classList.toggle('hidden',!me?.isAdmin); $('#channelDescription').readOnly=!me?.isAdmin; setAvatar($('#channelAvatarBtn'),{username:'205',avatarUrl:channel.avatarUrl||''}); openModal('channelProfileModal');
}
$('#chatProfileOpen').onclick=openChatProfile;
$('#channelAvatarBtn').onclick=()=>{if(me?.isAdmin)$('#channelAvatarInput').click()};
$('#channelAvatarInput').onchange=async()=>{const file=$('#channelAvatarInput').files[0];if(!file)return;try{const fd=new FormData();fd.append('avatar',file);const d=await api('/api/channel/avatar',{method:'POST',body:fd});channel=d.channel;await loadChannel();setAvatar($('#channelAvatarBtn'),{username:'205',avatarUrl:channel.avatarUrl||''});toast('Аватар 205chat обновлён')}catch(err){toast(err.message)}};
$('#saveChannelDescription').onclick=async()=>{try{const d=await api('/api/channel',{method:'PATCH',body:JSON.stringify({description:$('#channelDescription').value})});channel=d.channel;toast('Описание сохранено')}catch(err){toast(err.message)}};
$('#clearGlobalChat').onclick=async()=>{if(!confirm('Очистить ВСЕ сообщения в 205chat? Личные сообщения останутся.'))return;try{await api('/api/channel/messages',{method:'DELETE'});$('#messages').innerHTML='';closeModal('channelProfileModal');toast('205chat очищен')}catch(err){toast(err.message)}};

function setAdminTab(tab){$$('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===tab));$('#adminUsersTab').classList.toggle('hidden',tab!=='users');$('#adminGiftsTab').classList.toggle('hidden',tab!=='gifts');if(tab==='gifts')loadAdminMarket();}
$$('[data-admin-tab]').forEach(b=>b.onclick=()=>setAdminTab(b.dataset.adminTab));
function renderAdminUsers(list=adminUsersCache){
  const tb=$('#usersTable');tb.innerHTML='';list.forEach(u=>{const tr=document.createElement('tr');tr.innerHTML=`<td><b>@${escapeHtml(u.username)}</b> ${badge(u)}${u.isAdmin?'<br><small>Admin</small>':''}</td><td>${escapeHtml(u.phone)}</td><td><span class="status"><span class="dot ${u.online?'on':''}"></span>${u.online?'онлайн':'оффлайн'}</span></td><td><button class="verify-btn ${u.verified?'on':''}" data-id="${u.id}" data-v="${u.verified}" ${u.rootAdmin?'disabled':''}>${u.verified?'✓':'+'}</button></td><td><button class="admin-role-btn ${u.isAdmin?'on':''}" data-admin-id="${u.id}" data-a="${u.isAdmin}" ${u.rootAdmin?'disabled':''}>${u.isAdmin?'Admin':'User'}</button></td><td><div class="berry-admin-cell"><b>${u.strawberries||0}🍓</b><input type="number" step="1" placeholder="любое количество" data-berry-input="${u.id}"><button class="verify-btn" data-berry-give="${u.id}">Выдать</button></div></td>`;tb.appendChild(tr)});
  tb.querySelectorAll('.verify-btn[data-v]:not([disabled])').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/users/'+b.dataset.id+'/verified',{method:'PATCH',body:JSON.stringify({verified:b.dataset.v!=='true'})});await openAdmin()}catch(err){toast(err.message)}});
  tb.querySelectorAll('.admin-role-btn:not([disabled])').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/users/'+b.dataset.adminId+'/admin',{method:'PATCH',body:JSON.stringify({isAdmin:b.dataset.a!=='true'})});await openAdmin()}catch(err){toast(err.message)}});
  tb.querySelectorAll('[data-berry-give]').forEach(b=>b.onclick=async()=>{const id=b.dataset.berryGive;const input=tb.querySelector(`[data-berry-input="${CSS.escape(id)}"]`);const amount=Number(input.value);if(!Number.isFinite(amount)||!amount)return toast('Укажи количество');try{await api('/api/admin/users/'+id+'/strawberries',{method:'POST',body:JSON.stringify({amount})});toast('Баланс изменён');await openAdmin()}catch(err){toast(err.message)}});
}
async function openAdmin(){
  try{const d=await api('/api/admin/users');adminUsersCache=d.users||[];renderAdminUsers();openModal('adminModal');setAdminTab('users');await loadPurchasesAdmin();}catch(err){toast(err.message)}
}
$('#adminUserSearch').oninput=e=>{const q=(e.target.value||'').trim().toLowerCase().replace(/^@/,'');renderAdminUsers(adminUsersCache.filter(u=>!q||u.username.toLowerCase().includes(q)||(u.phone||'').includes(q)));};
$('#adminBtn').onclick=openAdmin;
$('#sideAdmin').onclick=()=>{ $('#sideMenu').classList.add('hidden'); $('#sidebar').classList.remove('mobile-open'); openAdmin(); };
$('#refreshAdminBtn').onclick=openAdmin;
$('#adminChannelBtn').onclick=()=>{ closeModal('adminModal'); openChatProfile(); };

async function openAdminAudit(){if(!me?.isAdmin)return;closeModal('adminModal');$('#adminAuditPage').classList.remove('hidden');$('#sidebar').classList.remove('mobile-open');auditSelectedUser=null;$('#auditUserSearch').value='';$('#auditConversations').innerHTML='<div class="empty-state">Выберите пользователя</div>';$('#auditMessages').innerHTML='<div class="empty-state">Выберите переписку</div>';await loadAuditUsers();}
async function loadAuditUsers(q=''){try{const d=await api('/api/admin/audit/users'+(q?`?q=${encodeURIComponent(q)}`:''));const box=$('#auditUsers');box.innerHTML='';(d.users||[]).forEach(u=>{const b=document.createElement('button');b.className='audit-user-row';b.innerHTML=`<span class="avatar">${escapeHtml(initials(u))}</span><span><b>@${escapeHtml(u.username)}</b><small>${escapeHtml(u.phone||'')}</small></span>`;if(u.avatarUrl)b.querySelector('.avatar').style.backgroundImage=`url('${u.avatarUrl}')`;b.onclick=()=>loadAuditConversations(u);box.appendChild(b)});if(!box.children.length)box.innerHTML='<div class="empty-state">Не найдено</div>'}catch(e){toast(e.message)}}
async function loadAuditConversations(u){auditSelectedUser=u;try{const d=await api('/api/admin/audit/conversations/'+encodeURIComponent(u.id));const box=$('#auditConversations');box.innerHTML=`<div class="audit-column-title">Переписки @${escapeHtml(u.username)}</div>`;(d.conversations||[]).forEach(c=>{const b=document.createElement('button');b.className='audit-conversation-row';b.innerHTML=`<b>@${escapeHtml(c.peer.username)}</b><span>${escapeHtml(c.lastText||'')}</span><small>${c.count} сообщений</small>`;b.onclick=()=>loadAuditMessages(u,c.peer);box.appendChild(b)});if((d.conversations||[]).length===0)box.innerHTML+='<div class="empty-state">Личных переписок нет</div>';$('#auditMessages').innerHTML='<div class="empty-state">Выберите переписку</div>'}catch(e){toast(e.message)}}
async function loadAuditMessages(a,b){try{const d=await api(`/api/admin/audit/messages/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}`);const box=$('#auditMessages');box.innerHTML=`<div class="audit-chat-title">@${escapeHtml(a.username)} ↔ @${escapeHtml(b.username)}</div>`;(d.messages||[]).forEach(m=>{const row=document.createElement('div');row.className='audit-message';row.innerHTML=`<b>@${escapeHtml(m.sender?.username||'user')}</b>${mediaMarkup(m)}${m.text?`<div>${escapeHtml(m.text)}</div>`:''}<small>${new Date(m.createdAt).toLocaleString()}</small>`;box.appendChild(row)});if(!(d.messages||[]).length)box.innerHTML+='<div class="empty-state">Сообщений нет</div>';box.scrollTop=box.scrollHeight}catch(e){toast(e.message)}}
$('#auditUserSearch').oninput=e=>{clearTimeout(window.__auditTimer);window.__auditTimer=setTimeout(()=>loadAuditUsers(e.target.value),180)};
$('#closeAdminAudit').onclick=()=>$('#adminAuditPage').classList.add('hidden');
$('#adminAuditBtn').onclick=openAdminAudit;
function messageBelongsCurrent(m){
  if(!currentPeer)return m.chatType!=='private';
  return m.chatType==='private'&&(m.sender?.id===currentPeer||m.recipientId===currentPeer||(m.mine&&m.recipientId===currentPeer));
}
function connect(){
  socket?.disconnect();
  socket=io({auth:{token}});
  socket.on('connect_error',()=>toast(lang==='ru'?'Ошибка подключения':'Connection error'));
  socket.on('message',async m=>{
    if(messageBelongsCurrent(m)){ renderMessage(m); requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight}); }
    if(m.chatType==='private')await loadContacts();
  });
  socket.on('private-chat-cleared',()=>{if(currentPeer)loadMessages()});
  socket.on('message-deleted',id=>document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`)?.remove());
  socket.on('message-hidden',id=>document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`)?.remove());
  socket.on('message-views',x=>{const row=document.querySelector(`.msg[data-id="${CSS.escape(x.id)}"]`);if(row)row.querySelector('.view-count').textContent=x.views});
  socket.on('message-reactions',x=>{const row=document.querySelector(`.msg[data-id="${CSS.escape(x.id)}"]`);if(!row)return;const holder=row.querySelector('.reactions');const html=Object.entries(x.reactions||{}).filter(([,v])=>v.count).map(([e,v])=>`<button class="reaction-chip ${v.mine?'mine':''}" data-emoji="${e}">${e}${v.count}</button>`).join('');if(holder){holder.innerHTML=html;if(!html)holder.remove()}else if(html){const d=document.createElement('div');d.className='reactions';d.innerHTML=html;row.querySelector('.message-meta').before(d)}row.querySelectorAll('.reaction-chip').forEach(b=>b.onclick=()=>socket.emit('react-message',{id:x.id,emoji:b.dataset.emoji}))});
  socket.on('pin-changed',()=>loadMessages());
  socket.on('typing',x=>{
    if(x.userId===me.id)return;
    const relevant=currentPeer?(x.peerId===me.id&&x.userId===currentPeer):(!x.peerId);
    if(!relevant)return;
    $('#typing').textContent=x.isTyping?`@${x.username} ${lang==='ru'?'печатает…':'is typing…'}`:'';
  });
  socket.on('user-updated',async u=>{ if(u.id===me.id){me={...me,...u};syncMeUI()} contacts=contacts.map(c=>c.id===u.id?{...c,...u}:c); if(currentPeerUser?.id===u.id)currentPeerUser={...currentPeerUser,...u}; renderContacts(); updateChatHeader(); });
  socket.on('presence',x=>{contacts=contacts.map(c=>c.id===x.id?{...c,online:x.online}:c);if(currentPeerUser?.id===x.id)currentPeerUser.online=x.online;renderContacts();updateChatHeader()});
  socket.on('participants',n=>{updateChatHeader(n);$('#channelMembers').textContent=`${n} ${lang==='ru'?'участников':'members'}`});
  socket.on('channel-updated',c=>{channel=c||channel;$('#channelDescription').value=channel.description||'';updateChatHeader();setAvatar($('#channelAvatarBtn'),{username:'205',avatarUrl:channel.avatarUrl||''})});
  socket.on('global-chat-cleared',()=>{if(!currentPeer)$('#messages').innerHTML=''});
}

async function startApp(){
  try{
    if(!me){const d=await api('/api/me');me=d.user}
    $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
    currentPeer=null; currentPeerUser=null; syncMeUI(); await Promise.all([loadContacts(),refreshStats(),loadChannel()]); await loadMessages(); connect();
  }catch(err){console.error(err);localStorage.removeItem('205token');token=null;$('#auth').classList.remove('hidden');$('#app').classList.add('hidden')}
}

// v8 bootstrap is at the end of the file

/* ========================= 205chating v8 ========================= */
function giftBadge(u){
  const g=u?.featuredGift;
  return g?.image?`<img class="featured-gift-badge" src="${escapeHtml(g.image)}" title="${escapeHtml(g.name||'Подарок')}">`:'';
}
function badge(u){ return ((u?.verified || u?.isAdmin) ? '<span class="check">✓</span>' : '') + giftBadge(u); }
function compactText(m){
  if(m.type==='gift'&&m.gift)return `🎁 ${m.gift.name}`;
  if(m.text)return m.text.slice(0,80);
  if(m.type==='image')return lang==='ru'?'Фото':'Photo'; if(m.type==='video')return lang==='ru'?'Видео':'Video'; if(m.type==='audio')return lang==='ru'?'Голосовое сообщение':'Voice message';
  return '';
}
function resetModes(){ supportMode=null; supportUserId=null; supportUser=null; }
function updateComposerMode(){
  const privateGift=!!currentPeer&&!supportMode;
  $('#giftBtn')?.classList.toggle('hidden',!privateGift);
  const recordingAllowed=!supportMode;
  $('#attachBtn')?.classList.toggle('hidden',!!supportMode);
  $('.record-mode')?.classList.toggle('hidden',!recordingAllowed);
  $('#recordBtn')?.classList.toggle('hidden',!recordingAllowed);
  $('#messageInput').placeholder=supportMode?(lang==='ru'?'Сообщение в поддержку':'Support message'):t('chat.message');
}
function syncMeUI(){
  if(!me)return;
  $('#meName').innerHTML='@'+escapeHtml(me.username)+badge(me); $('#mePhone').textContent=me.phone;
  $('#profileName').innerHTML='@'+escapeHtml(me.username)+badge(me); $('#profilePhone').textContent=me.phone;
  $('#profileUsername').value=me.username; $('#profileBio').value=me.bio||''; if($('#hidePhoneSetting'))$('#hidePhoneSetting').checked=!!me.phoneHidden; $('#bioCount').textContent=String((me.bio||'').length);
  $('#profileBerryBalance').textContent=`${me.strawberries||0}🍓`; $('#settingsBerryBalance').textContent=`${me.strawberries||0}🍓`; if($('#marketBalance'))$('#marketBalance').textContent=`${me.strawberries||0}🍓`; if($('#balancePageAmount'))$('#balancePageAmount').textContent=`${me.strawberries||0}🍓`; 
  setAvatar($('#meAvatar'),me); setAvatar($('#mobileProfile'),me); setAvatar($('#avatarButton'),me);
  $('#adminBtn').classList.toggle('hidden',!me.isAdmin); $('#sideAdmin')?.classList.toggle('hidden',!me.isAdmin);
  rememberAccount(me,token); renderAccounts(); renderMyGifts();
}
function updateChatHeader(participantCount){
  if(supportMode==='user'){
    $('#chatTitle').innerHTML='чат с ботом <span class="check orange-check">✓</span>'; $('#chatSubtitle').textContent='поддержка 205chating'; $('#chatSubtitle').classList.remove('online-status'); setAvatar($('#chatHeaderAvatar'),{username:'БО',avatarUrl:''});
  }else if(supportMode==='inbox'){
    $('#chatTitle').innerHTML='Поддержка <span class="check orange-check">✓</span>'; $('#chatSubtitle').textContent='обращения пользователей'; $('#chatSubtitle').classList.remove('online-status'); setAvatar($('#chatHeaderAvatar'),{username:'SP',avatarUrl:''});
  }else if(supportMode==='admin'){
    $('#chatTitle').innerHTML='чат с ботом <span class="check orange-check">✓</span>'; $('#chatSubtitle').textContent=supportUser?`заявка @${supportUser.username}`:'заявка пользователя'; $('#chatSubtitle').classList.remove('online-status'); setAvatar($('#chatHeaderAvatar'),supportUser||{username:'SP'});
  }else if(currentPeer && currentPeerUser){
    $('#chatTitle').innerHTML='@'+escapeHtml(currentPeerUser.username)+badge(currentPeerUser); setAvatar($('#chatHeaderAvatar'),currentPeerUser);
    $('#chatSubtitle').textContent=currentPeerUser.online?(lang==='ru'?'в сети':'online'):(lang==='ru'?'был(а) недавно':'last seen recently'); $('#chatSubtitle').classList.toggle('online-status',!!currentPeerUser.online);
  }else{
    $('#chatTitle').innerHTML='205chat <span class="check orange-check">✓</span>'; $('#chatSubtitle').classList.remove('online-status'); setAvatar($('#chatHeaderAvatar'),{username:'205',avatarUrl:channel.avatarUrl||''}); setAvatar($('#channelAvatarSide'),{username:'205',avatarUrl:channel.avatarUrl||''});
    const n=participantCount ?? Number($('#chatSubtitle').dataset.count||0); $('#chatSubtitle').dataset.count=n; $('#chatSubtitle').textContent=n?`${n} ${lang==='ru'?'участников':'members'}`:(lang==='ru'?'общий чат':'global chat');
  }
  updateComposerMode();
}

function contactRow(u){
  const b=document.createElement('button'); b.className='contact-item'+(!supportMode&&currentPeer===u.id?' active':''); b.dataset.peer=u.id;
  const av=document.createElement('div'); av.className='avatar'; setAvatar(av,u); const copy=document.createElement('div'); copy.className='contact-copy';
  copy.innerHTML=`<b>@${escapeHtml(u.username)}${badge(u)}</b><span>${u.online?'в сети':'был(а) недавно'}</span>`;
  av.onclick=e=>{e.stopPropagation();openUserProfile(u)}; b.append(av,copy); b.onclick=()=>openPeer(u); return b;
}
function supportContactRow(){
  const wrap=document.createElement('div'); wrap.className='contact-item support-contact'+(supportMode?' active':'');
  const main=document.createElement('button'); main.className='support-contact-main'; main.innerHTML='<div class="avatar support-avatar">205</div><div class="contact-copy"><b>чат с ботом <span class="check">✓</span></b><span>поддержка • клубнички</span></div>';
  main.onclick=()=>me?.isAdmin?openSupportInbox():openSupportUser(); wrap.appendChild(main);
  if(!me?.isAdmin){const del=document.createElement('button');del.className='support-remove';del.textContent='×';del.title='Удалить чат';del.onclick=async e=>{e.stopPropagation();try{await api('/api/support/hide',{method:'DELETE'});supportVisible=false;if(supportMode){resetModes();currentPeer=null;await loadMessages();}renderContacts();updateChatHeader()}catch(err){toast(err.message)}};wrap.appendChild(del);}
  return wrap;
}
function renderContacts(){
  const box=$('#contactsList'); if(!box)return; box.innerHTML='';
  const q=contactSearch.trim().toLowerCase().replace(/^@/,'');
  if(me?.isAdmin&&!q){const audit=document.createElement('button');audit.className='contact-item admin-audit-contact';audit.innerHTML='<div class="avatar audit-avatar">⌕</div><div class="contact-copy"><b>Контакты</b><span>все пользователи и переписки</span></div>';audit.onclick=openAdminAudit;box.appendChild(audit);}
  if((me?.isAdmin||supportVisible)&&(!q||'чат с ботом поддержка'.includes(q)))box.appendChild(supportContactRow());
  contacts.filter(u=>!q||u.username.toLowerCase().includes(q)||(u.phone||'').includes(q)).forEach(u=>box.appendChild(contactRow(u)));
  if(!box.children.length)box.innerHTML='<div class="empty-contact">Ничего не найдено</div>';
}
async function loadContacts(){
  try{
    const [d,s]=await Promise.all([api('/api/contacts'),api('/api/support/status')]); contacts=d.contacts||[]; supportVisible=!!s.visible;
    if(currentPeer&&!supportMode)currentPeerUser=contacts.find(x=>x.id===currentPeer)||currentPeerUser; renderContacts(); updateChatHeader();
  }catch(err){toast(err.message)}
}
$('#sidebarSearch').oninput=e=>{contactSearch=e.target.value||'';renderContacts();};
async function openPeer(u){ resetModes(); currentPeer=u.id; currentPeerUser=u; replyTo=null; clearReply(); $('#sidebar').classList.remove('mobile-open'); $('#globalChat').classList.remove('active'); renderContacts(); updateChatHeader(); await loadMessages(); }
$('#globalChat').onclick=async()=>{ resetModes(); currentPeer=null; currentPeerUser=null; replyTo=null; clearReply(); $('#globalChat').classList.add('active'); $('#sidebar').classList.remove('mobile-open'); renderContacts(); await refreshStats(); await loadMessages(); };

function giftMessageMarkup(m){
  if(!m.gift)return '';
  const g=m.gift; const sender=g.sender; const senderAv=sender?.avatarUrl?`<span class="gift-sender-avatar" style="background-image:url('${escapeHtml(sender.avatarUrl)}')"></span>`:`<span class="gift-sender-avatar">${escapeHtml(initials(sender))}</span>`;
  return `<div class="gift-message"><img src="${escapeHtml(g.image)}" alt="${escapeHtml(g.name)}"><div class="gift-message-copy"><b>${escapeHtml(g.name)}</b><span>${g.price}🍓</span>${sender?`<div class="gift-sender">${senderAv}<small>От @${escapeHtml(sender.username)}</small></div>`:''}${g.letter?`<blockquote>${escapeHtml(g.letter)}</blockquote>`:''}</div></div>`;
}
function mediaMarkup(m){
  if(m.type==='gift')return giftMessageMarkup(m);
  if(m.type==='image')return `<img class="media-image" src="${escapeHtml(m.mediaUrl)}" alt="image">`;
  if(m.type==='video')return `<video class="media-video" src="${escapeHtml(m.mediaUrl)}" controls playsinline preload="metadata"></video>`;
  if(m.type==='audio')return `<audio class="media-audio" src="${escapeHtml(m.mediaUrl)}" controls preload="metadata"></audio>`;
  return '';
}
function renderMessage(m,{append=true}={}){
  if(supportMode)return null;
  if(currentPeer){const belongs=m.chatType==='private'&&(m.sender?.id===currentPeer||m.recipientId===currentPeer||(m.mine&&m.recipientId===currentPeer));if(!belongs)return null;} else if(m.chatType==='private')return null;
  const existing=document.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`); if(existing)existing.remove();
  const row=document.createElement('div'); row.className='msg'+(m.mine?' mine':''); row.dataset.id=m.id; const av=document.createElement('button'); av.className='avatar msg-avatar avatar-button'; setAvatar(av,m.sender); if(m.sender?.id)av.onclick=()=>openUserProfile(m.sender);
  const bubble=document.createElement('div'); bubble.className='bubble'; const body=mediaMarkup(m)+(m.text?`<div class="text${m.type!=='text'?' caption':''}">${escapeHtml(m.text)}</div>`:'');
  bubble.innerHTML=`<button class="name name-button">@${escapeHtml(m.sender?.username||'Пользователь')}${badge(m.sender)}</button>${replyMarkup(m)}${body}${m.anonymousRealSender?`<div class="anon-real">@${escapeHtml(m.anonymousRealSender.username)} · ${escapeHtml(m.anonymousRealSender.phone)}</div>`:''}${reactionsMarkup(m)}<div class="message-meta"><span>${formatTime(m.createdAt)}</span>${currentPeer?'':`<span class="message-views"><span class="eye-icon">◉</span><span class="view-count">${m.views||0}</span></span>`}<button class="more-btn" aria-label="More">⋯</button></div>`;
  bubble.querySelector('.more-btn').onclick=e=>openMessageMenu(e.currentTarget,m); const nameBtn=bubble.querySelector('.name-button'); if(nameBtn&&m.sender?.id)nameBtn.onclick=()=>openUserProfile(m.sender); bubble.querySelectorAll('.reaction-chip').forEach(btn=>btn.onclick=()=>socket?.emit('react-message',{id:m.id,emoji:btn.dataset.emoji}));
  row.append(av,bubble); if(append)$('#messages').appendChild(row); observeMessage(row,m); if(!currentPeer)$('#lastPreview').textContent=`${m.sender?.username||''}: ${compactText(m)}`.slice(0,44); return row;
}

function renderSupportMessage(m){
  const row=document.createElement('div'); row.className='msg support-msg'+(m.mine?' mine':''); row.dataset.id=m.id; const av=document.createElement('div');av.className='avatar msg-avatar';setAvatar(av,m.sender);
  const bubble=document.createElement('div');bubble.className='bubble support-bubble';bubble.innerHTML=`<div class="name">@${escapeHtml(m.sender?.username||'Поддержка')}${badge(m.sender)}</div><div class="text">${escapeHtml(m.text||'')}</div><div class="message-meta"><span>${formatTime(m.createdAt)}</span></div>`;row.append(av,bubble);$('#messages').appendChild(row);
}
async function renderSupportTools(){ if(supportMode!=='user')return; const box=document.createElement('div');box.className='support-buy';box.innerHTML='<b>Пополнить 🍓 прямо здесь</b><div><button data-p="s100">100🍓 · 49₽</button><button data-p="s300">300🍓 · 119₽</button><button data-p="s750">750🍓 · 239₽</button></div><small>После выбора бот покажет номер для перевода. Подтверждение выполняет администратор.</small>';box.querySelectorAll('[data-p]').forEach(b=>b.onclick=async()=>{await createBerryPurchase(b.dataset.p);await loadSupportUserMessages()});$('#messages').appendChild(box); }
async function createBerryPurchase(packageId){try{const d=await api('/api/strawberries/purchase',{method:'POST',body:JSON.stringify({packageId})});toast(`Переведи ${d.purchase.rub}₽ на ${d.paymentPhone}`);await loadBalancePage()}catch(err){toast(err.message)}}
async function markPurchasePaid(id){try{await api('/api/strawberries/purchase/'+encodeURIComponent(id)+'/paid',{method:'POST'});toast('Отправлено на проверку');await loadBalancePage()}catch(err){toast(err.message)}}
async function loadSupportUserMessages(){const d=await api('/api/support/messages');$('#messages').innerHTML='';(d.messages||[]).forEach(renderSupportMessage);await renderSupportTools();requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight});}
async function loadSupportInbox(){
  const d=await api('/api/admin/support/threads');$('#messages').innerHTML='';const wrap=document.createElement('div');wrap.className='support-inbox';
  if(!(d.threads||[]).length)wrap.innerHTML='<div class="empty-state">Пока нет обращений пользователей.</div>';
  (d.threads||[]).forEach(t=>{const b=document.createElement('button');b.className='support-thread-card';const av=document.createElement('div');av.className='avatar';setAvatar(av,t.user);const copy=document.createElement('div');copy.innerHTML=`<b>@${escapeHtml(t.user.username)}</b><span>${escapeHtml(t.lastText||'Новое обращение')}</span><small>${new Date(t.updatedAt).toLocaleString()}</small>`;b.append(av,copy);b.onclick=()=>openSupportAdminThread(t.user);wrap.appendChild(b)});$('#messages').appendChild(wrap);
}
async function loadSupportAdminMessages(){const d=await api('/api/admin/support/'+encodeURIComponent(supportUserId)+'/messages');supportUser=d.user;$('#messages').innerHTML='';(d.messages||[]).forEach(renderSupportMessage);updateChatHeader();requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight});}
async function openSupportUser(){resetModes();supportMode='user';currentPeer=null;currentPeerUser=null;$('#globalChat').classList.remove('active');$('#sidebar').classList.remove('mobile-open');renderContacts();updateChatHeader();await loadMessages();}
async function openSupportInbox(){resetModes();supportMode='inbox';currentPeer=null;currentPeerUser=null;$('#globalChat').classList.remove('active');$('#sidebar').classList.remove('mobile-open');renderContacts();updateChatHeader();await loadMessages();}
async function openSupportAdminThread(u){supportMode='admin';supportUserId=u.id;supportUser=u;currentPeer=null;currentPeerUser=null;updateChatHeader();await loadMessages();}
async function loadMessages(){
  try{
    if(supportMode==='user')return await loadSupportUserMessages(); if(supportMode==='inbox')return await loadSupportInbox(); if(supportMode==='admin')return await loadSupportAdminMessages();
    const d=await api('/api/messages'+(currentPeer?`?peer=${encodeURIComponent(currentPeer)}`:'')); $('#messages').innerHTML=''; (d.messages||[]).forEach(m=>renderMessage(m)); updatePinned(d.messages||[]); requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight});
  }catch(err){toast(err.message)}
}
async function send(){
  if(mediaRecorder?.state==='recording'){stopRecording(true);return;}
  const text=$('#messageInput').value.trim();
  if(supportMode){
    if(!text)return;
    try{if(supportMode==='user')await api('/api/support/messages',{method:'POST',body:JSON.stringify({text})});else if(supportMode==='admin')await api('/api/admin/support/'+encodeURIComponent(supportUserId)+'/messages',{method:'POST',body:JSON.stringify({text})});else return;$('#messageInput').value='';await loadMessages();}catch(err){toast(err.message)} return;
  }
  if(!socket?.connected)return toast(lang==='ru'?'Нет соединения':'No connection'); if(!text&&!pendingMedia)return;
  const payload={text,recipientId:currentPeer||null,replyTo:replyTo?.id||null}; if(pendingMedia)Object.assign(payload,{type:pendingMedia.type,mediaUrl:pendingMedia.url,fileName:pendingMedia.name,mime:pendingMedia.mime});else payload.type='text'; socket.emit('send-message',payload); $('#messageInput').value='';clearPendingMedia();clearReply();socket.emit('typing',{isTyping:false,peerId:currentPeer||null});
}
$('#send').onclick=send;

let marketFilter='newest';
async function loadGiftCatalog(){try{const d=await api('/api/gifts/catalog');giftCatalog=d.catalog||[];renderGiftCatalog()}catch(e){console.error(e)}}
function renderGiftCatalog(){
  const box=$('#giftCatalog');if(!box)return;box.innerHTML='';
  const now=Date.now();let list=[...giftCatalog];
  if(marketFilter==='upcoming')list=list.filter(g=>g.releaseAt&&new Date(g.releaseAt).getTime()>now);
  else if(marketFilter==='nft')list=list.filter(g=>g.type==='nft'&&(!g.releaseAt||new Date(g.releaseAt).getTime()<=now));
  else if(marketFilter!=='all')list=list.filter(g=>!g.releaseAt||new Date(g.releaseAt).getTime()<=now);
  if(marketFilter==='price_desc')list.sort((a,b)=>b.price-a.price);
  else if(marketFilter==='price_asc')list.sort((a,b)=>a.price-b.price);
  else list.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  if(!list.length){box.innerHTML='<div class="empty-state">На рынке пока ничего нет</div>';return}
  list.forEach(g=>{const upcoming=!!g.releaseAt&&new Date(g.releaseAt).getTime()>now;const b=document.createElement('button');b.className='market-gift-card'+(selectedGiftKey===g.key?' selected':'')+(g.soldOut?' soldout':'')+(upcoming?' upcoming':'');const stock=g.remaining;b.innerHTML=`<div class="market-gift-image"><img src="${escapeHtml(g.image)}"><span class="market-type ${g.type==='nft'?'nft':''}">${g.type==='nft'?'NFT':'GIFT'}</span></div><div class="market-gift-copy"><b>${escapeHtml(g.name)}</b><span>${g.price}🍓</span><small>${upcoming?'Выйдет: '+new Date(g.releaseAt).toLocaleString():'На рынке: '+stock}</small></div>`;b.disabled=!!g.soldOut||upcoming;b.onclick=()=>{selectedGiftKey=g.key;renderGiftCatalog();renderGiftCompose()};box.appendChild(b)});
}
function renderGiftCompose(){const g=giftCatalog.find(x=>x.key===selectedGiftKey);const area=$('#giftCompose');if(!g){area.classList.add('hidden');return}area.classList.remove('hidden');$('#selectedGiftPreview').innerHTML=`<img src="${escapeHtml(g.image)}"><div><b>${escapeHtml(g.name)}</b><span>${g.price}🍓 · ${g.type==='nft'?'NFT':'подарок'}</span><small>Осталось: ${g.remaining}</small></div>`;}
async function openGiftMarket(){if(!currentPeer||supportMode)return;selectedGiftKey=null;$('#giftLetter').value='';$('#giftLetterCount').textContent='0';$('#marketBalance').textContent=`${me.strawberries||0}🍓`;$('#giftMarketPeer').textContent=currentPeerUser?`Подарок для @${currentPeerUser.username}`:'Подарок другу';marketFilter=$('#marketSort')?.value||'newest';await loadGiftCatalog();renderGiftCompose();$('#giftMarketPage').classList.remove('hidden')}
$('#marketSort').onchange=e=>{marketFilter=e.target.value;selectedGiftKey=null;renderGiftCompose();renderGiftCatalog();};
$('#giftBtn').onclick=openGiftMarket;
$('#closeGiftMarket').onclick=()=>$('#giftMarketPage').classList.add('hidden');
$('#closeGiftCompose').onclick=()=>{selectedGiftKey=null;renderGiftCatalog();renderGiftCompose()};
document.querySelectorAll('[data-market-filter]').forEach(b=>b.onclick=()=>{marketFilter=b.dataset.marketFilter;document.querySelectorAll('[data-market-filter]').forEach(x=>x.classList.toggle('active',x===b));renderGiftCatalog()});
$('#giftLetter').oninput=()=>$('#giftLetterCount').textContent=String($('#giftLetter').value.length);
$('#sendGift').onclick=async()=>{if(!selectedGiftKey||!currentPeer)return;try{const d=await api('/api/gifts/send',{method:'POST',body:JSON.stringify({recipientId:currentPeer,giftKey:selectedGiftKey,letter:$('#giftLetter').value})});me.strawberries=d.balance;syncMeUI();$('#giftMarketPage').classList.add('hidden');toast('Подарок отправлен')}catch(err){toast(err.message)}};
function renderMyGifts(){
  const box=$('#myGifts');if(!box)return;box.innerHTML='';if(!myGifts.length){box.innerHTML='<span class="gift-empty">Пока нет подарков</span>';return}myGifts.forEach(g=>{const b=document.createElement('button');b.className='profile-gift'+(me?.featuredGift?.id===g.id?' featured':'');b.innerHTML=`<img src="${escapeHtml(g.image)}"><span>${escapeHtml(g.name)}</span>${g.type==='nft'?`<small>NFT #${g.serial||'—'}</small>`:''}`;b.title=me?.featuredGift?.id===g.id?'Открепить подарок':'Закрепить возле профиля';b.onclick=()=>featureGift(g.id);box.appendChild(b)})
}
async function loadMyGifts(){try{const d=await api('/api/gifts/mine');myGifts=d.gifts||[];me.strawberries=d.balance;renderMyGifts();syncMeUI()}catch(e){console.error(e)}}
async function featureGift(id){try{const d=await api('/api/gifts/feature',{method:'POST',body:JSON.stringify({giftId:me?.featuredGift?.id===id?null:id})});me=d.user;syncMeUI();renderMyGifts();toast(me.featuredGift?'Подарок закреплён возле профиля':'Подарок откреплён')}catch(err){toast(err.message)}}
async function openUserProfile(user){
  try{const d=user?.id?await api('/api/users/'+encodeURIComponent(user.id)):{user:me,gifts:myGifts};const u=d.user;setAvatar($('#viewUserAvatar'),u);$('#viewUserName').innerHTML='@'+escapeHtml(u.username)+badge(u);$('#viewUserPhone').textContent=u.phone||'Номер скрыт';$('#viewUserBio').textContent=u.bio||'—';$('#writeUserBtn').classList.toggle('hidden',u.id===me.id);$('#publicContactActions').classList.toggle('hidden',u.id===me.id);$('#writeUserBtn').onclick=()=>{closeModal('userProfileModal');openPeer(u)};$('#clearPrivateChat').onclick=async()=>{if(!confirm('Очистить всю личную переписку с @'+u.username+'?'))return;try{await api('/api/private/'+encodeURIComponent(u.id)+'/messages',{method:'DELETE'});closeModal('userProfileModal');if(currentPeer===u.id)await loadMessages();toast('Чат очищен')}catch(e){toast(e.message)}};$('#deleteContact').onclick=async()=>{if(!confirm('Удалить @'+u.username+' из контактов?'))return;try{await api('/api/contacts/'+encodeURIComponent(u.id),{method:'DELETE'});contacts=contacts.filter(x=>x.id!==u.id);if(currentPeer===u.id){currentPeer=null;currentPeerUser=null;await loadMessages()}renderContacts();closeModal('userProfileModal');toast('Контакт удалён')}catch(e){toast(e.message)}};const box=$('#viewUserGifts');box.innerHTML='';(d.gifts||[]).forEach(g=>{const el=document.createElement('div');el.className='profile-gift readonly gift-with-sender'+(u.featuredGift?.id===g.id?' featured':'');const sav=document.createElement('button');sav.className='gift-card-sender avatar';setAvatar(sav,g.sender||{username:'?'});sav.title='@'+(g.sender?.username||'user');sav.onclick=e=>{e.stopPropagation();if(g.sender?.id)openUserProfile(g.sender)};el.innerHTML=`<img src="${escapeHtml(g.image)}"><span>${escapeHtml(g.name)}</span>${g.type==='nft'?`<small>NFT #${g.serial||'—'}</small>`:''}`;el.prepend(sav);el.title=g.letter?`“${g.letter}” — @${g.sender?.username||'user'}`:`От @${g.sender?.username||'user'}`;box.appendChild(el)});if(!(d.gifts||[]).length)box.innerHTML='<span class="gift-empty">Подарков пока нет</span>';setPublicProfileTab('main');openModal('userProfileModal')}catch(err){toast(err.message)}
}
function setProfileTab(tab){document.querySelectorAll('[data-profile-tab]').forEach(b=>b.classList.toggle('active',b.dataset.profileTab===tab));$('#profileMainTab').classList.toggle('hidden',tab!=='main');$('#profileGiftsTab').classList.toggle('hidden',tab!=='gifts');document.querySelector('#profileModal .account-section')?.classList.toggle('hidden',tab!=='main');if(tab==='gifts')loadMyGifts()}
document.querySelectorAll('[data-profile-tab]').forEach(b=>b.onclick=()=>setProfileTab(b.dataset.profileTab));
function setPublicProfileTab(tab){document.querySelectorAll('[data-public-tab]').forEach(b=>b.classList.toggle('active',b.dataset.publicTab===tab));$('#publicMainTab').classList.toggle('hidden',tab!=='main');$('#publicGiftsTab').classList.toggle('hidden',tab!=='gifts')}
document.querySelectorAll('[data-public-tab]').forEach(b=>b.onclick=()=>setPublicProfileTab(b.dataset.publicTab));

async function loadBalancePage(){
  try{const [pd,md,meData]=await Promise.all([api('/api/strawberries/packages'),api('/api/strawberries/purchases/mine'),api('/api/me')]);me={...me,...meData.user};syncMeUI();myPurchases=md.purchases||[];$('#balancePageAmount').textContent=`${me.strawberries||0}🍓`;const box=$('#balancePackages');box.innerHTML=pd.packages.map(p=>`<button class="balance-pack" data-balance-pack="${p.id}"><b>${p.berries}🍓</b><span>${p.rub}₽</span><small>Перевод на ${escapeHtml(pd.paymentPhone)}</small></button>`).join('');box.querySelectorAll('[data-balance-pack]').forEach(b=>b.onclick=()=>createBerryPurchase(b.dataset.balancePack));const pb=$('#balancePurchases');pb.innerHTML='';myPurchases.filter(p=>['pending','paid'].includes(p.status)).forEach(p=>{const row=document.createElement('div');row.className='balance-purchase';row.innerHTML=`<div><b>${p.berries}🍓 · ${p.rub}₽</b><span>${p.status==='paid'?'На проверке у администратора':'После перевода нажми «Я оплатил»'}</span></div>${p.status==='pending'?'<button class="small-primary">Я оплатил</button>':'<span class="purchase-wait">Проверяется</span>'}`;row.querySelector('button')?.addEventListener('click',()=>markPurchasePaid(p.id));pb.appendChild(row)});if(!pb.children.length)pb.innerHTML='<span class="gift-empty">Активных пополнений нет</span>'}catch(err){toast(err.message)}
}

$('#hidePhoneSetting')?.addEventListener('change',async e=>{try{const d=await api('/api/profile',{method:'PATCH',body:JSON.stringify({username:me.username,bio:me.bio||'',hidePhone:e.target.checked})});me=d.user;syncMeUI();toast(e.target.checked?'Номер скрыт':'Номер снова виден')}catch(err){e.target.checked=!e.target.checked;toast(err.message)}});

$('#openBalance').onclick=async()=>{$('#settingsPage').classList.add('hidden');$('#balancePage').classList.remove('hidden');await loadBalancePage()};
$('#closeBalancePage').onclick=()=>{$('#balancePage').classList.add('hidden');$('#settingsPage').classList.remove('hidden')};
$('#openSupport').onclick=async()=>{try{$('#settingsPage').classList.add('hidden');if(me?.isAdmin)return openSupportInbox();await api('/api/support/open',{method:'POST'});supportVisible=true;renderContacts();await openSupportUser()}catch(err){toast(err.message)}};

async function loadPurchasesAdmin(){
  if(!me?.isAdmin)return;try{const d=await api('/api/admin/purchases');const box=$('#purchaseList');box.innerHTML='';const active=(d.purchases||[]).filter(p=>['pending','paid'].includes(p.status));if(!active.length){box.innerHTML='<span class="gift-empty">Нет заявок на проверку</span>';return}active.forEach(p=>{const row=document.createElement('div');row.className='purchase-row';row.innerHTML=`<div><b>@${escapeHtml(p.user.username)} · ${p.berries}🍓</b><span>${p.rub}₽ · ${p.status==='paid'?'пользователь отметил оплату':'ожидает оплаты'}</span><small>${escapeHtml(p.user.phone||'')}</small></div><div class="purchase-actions"><button class="small-primary approve">Подтвердить</button><button class="verify-btn reject">Отклонить</button></div>`;row.querySelector('.approve').onclick=()=>adminPurchase(p.id,'approve');row.querySelector('.reject').onclick=()=>adminPurchase(p.id,'reject');box.appendChild(row)})}catch(err){toast(err.message)}
}
async function adminPurchase(id,action){try{await api('/api/admin/purchases/'+id+'/'+action,{method:'POST'});toast(action==='approve'?'Начислено 🍓':'Заявка отклонена');await loadPurchasesAdmin();await openAdmin()}catch(err){toast(err.message)}}
async function loadAdminMarket(){
  if(!me?.isAdmin)return;try{const d=await api('/api/admin/gifts');const box=$('#adminMarketList');box.innerHTML='';(d.catalog||[]).forEach(g=>{const upcoming=g.releaseAt&&new Date(g.releaseAt).getTime()>Date.now();const row=document.createElement('div');row.className='admin-market-row';row.innerHTML=`<img src="${escapeHtml(g.image)}"><div><b>${escapeHtml(g.name)} <em>${g.type==='nft'?'NFT':'подарок'}</em></b><span>${g.price}🍓 · осталось ${g.remaining}/${g.totalSupply}</span><small>${upcoming?'Выход: '+new Date(g.releaseAt).toLocaleString():(g.releaseAt?'Уже на рынке':'Вышел сразу')}</small></div><div class="admin-market-actions"><button class="verify-btn schedule-market">Дата</button><button class="verify-btn danger-market">Удалить</button></div>`;row.querySelector('.schedule-market').onclick=async()=>{const current=g.releaseAt?(()=>{const d=new Date(g.releaseAt),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`})():'';const v=prompt('Дата выхода в формате YYYY-MM-DDTHH:MM. Оставь пустым, чтобы выпустить сразу:',current);if(v===null)return;try{await api('/api/admin/gifts/'+encodeURIComponent(g.id),{method:'PATCH',body:JSON.stringify({releaseAt:v?new Date(v).toISOString():''})});await loadAdminMarket()}catch(e){toast(e.message)}};row.querySelector('.danger-market').onclick=async()=>{if(!confirm('Удалить подарок/NFT с рынка?'))return;try{await api('/api/admin/gifts/'+encodeURIComponent(g.id),{method:'DELETE'});await loadAdminMarket()}catch(e){toast(e.message)}};box.appendChild(row)});if(!box.children.length)box.innerHTML='<span class="gift-empty">Подарков пока нет. Создай первый выше.</span>'}catch(e){toast(e.message)}
}
$('#adminGiftForm').onsubmit=async e=>{e.preventDefault();const file=$('#adminGiftImage').files[0];if(!file)return toast('Выбери изображение');const fd=new FormData();fd.append('image',file);fd.append('name',$('#adminGiftName').value);fd.append('type',$('#adminGiftType').value);fd.append('price',$('#adminGiftPrice').value);fd.append('quantity',$('#adminGiftQuantity').value);{const rv=$('#adminGiftReleaseAt').value;fd.append('releaseAt',rv?new Date(rv).toISOString():'');}try{await api('/api/admin/gifts',{method:'POST',body:fd});e.target.reset();toast('Добавлено на рынок');await loadAdminMarket()}catch(err){toast(err.message)}};
$('#refreshMarketAdmin').onclick=loadAdminMarket;

$('#refreshPurchases').onclick=loadPurchasesAdmin;
$('#adminSupportBtn').onclick=()=>{closeModal('adminModal');openSupportInbox()};

function messageBelongsCurrent(m){if(supportMode)return false;if(!currentPeer)return m.chatType!=='private';return m.chatType==='private'&&(m.sender?.id===currentPeer||m.recipientId===currentPeer||(m.mine&&m.recipientId===currentPeer));}
function connect(){
  socket?.disconnect();socket=io({auth:{token}});socket.on('connect_error',()=>toast(lang==='ru'?'Ошибка подключения':'Connection error'));
  socket.on('message',async m=>{if(messageBelongsCurrent(m)){renderMessage(m);requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight})}if(m.chatType==='private')await loadContacts()});
  socket.on('private-chat-cleared',()=>{if(currentPeer)loadMessages()});
  socket.on('message-deleted',id=>document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`)?.remove());socket.on('message-hidden',id=>document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`)?.remove());
  socket.on('message-views',x=>{const row=document.querySelector(`.msg[data-id="${CSS.escape(x.id)}"]`);if(row)row.querySelector('.view-count')&&(row.querySelector('.view-count').textContent=x.views)});
  socket.on('message-reactions',x=>{const row=document.querySelector(`.msg[data-id="${CSS.escape(x.id)}"]`);if(!row)return;const holder=row.querySelector('.reactions');const html=Object.entries(x.reactions||{}).filter(([,v])=>v.count).map(([e,v])=>`<button class="reaction-chip ${v.mine?'mine':''}" data-emoji="${e}">${e}${v.count}</button>`).join('');if(holder){holder.innerHTML=html;if(!html)holder.remove()}else if(html){const d=document.createElement('div');d.className='reactions';d.innerHTML=html;row.querySelector('.message-meta').before(d)}row.querySelectorAll('.reaction-chip').forEach(b=>b.onclick=()=>socket.emit('react-message',{id:x.id,emoji:b.dataset.emoji}))});
  socket.on('pin-changed',()=>loadMessages());socket.on('typing',x=>{if(supportMode||x.userId===me.id)return;const relevant=currentPeer?(x.peerId===me.id&&x.userId===currentPeer):(!x.peerId);if(!relevant)return;$('#typing').textContent=x.isTyping?`@${x.username} ${lang==='ru'?'печатает…':'is typing…'}`:''});
  socket.on('user-updated',async u=>{if(u.id===me.id){me={...me,...u};syncMeUI()}contacts=contacts.map(c=>c.id===u.id?{...c,...u}:c);if(currentPeerUser?.id===u.id)currentPeerUser={...currentPeerUser,...u};if(supportUser?.id===u.id)supportUser={...supportUser,...u};renderContacts();updateChatHeader()});
  socket.on('presence',x=>{contacts=contacts.map(c=>c.id===x.id?{...c,online:x.online}:c);if(currentPeerUser?.id===x.id)currentPeerUser.online=x.online;renderContacts();updateChatHeader()});
  socket.on('participants',n=>{if(!supportMode)updateChatHeader(n);$('#channelMembers').textContent=`${n} ${lang==='ru'?'участников':'members'}`});socket.on('channel-updated',c=>{channel=c||channel;$('#channelDescription').value=channel.description||'';updateChatHeader();setAvatar($('#channelAvatarBtn'),{username:'205',avatarUrl:channel.avatarUrl||''})});socket.on('global-chat-cleared',()=>{if(!currentPeer&&!supportMode)$('#messages').innerHTML=''});
  socket.on('support-updated',x=>{if((supportMode==='user'&&x.userId===me.id)||(supportMode==='admin'&&x.userId===supportUserId)||supportMode==='inbox')loadMessages();});
}
async function startApp(){
  try{if(!me){const d=await api('/api/me');me=d.user}$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');resetModes();currentPeer=null;currentPeerUser=null;syncMeUI();await Promise.all([loadContacts(),refreshStats(),loadChannel(),loadGiftCatalog(),loadMyGifts()]);await loadMessages();connect()}catch(err){console.error(err);localStorage.removeItem('205token');token=null;$('#auth').classList.remove('hidden');$('#app').classList.add('hidden')}
}

applyPrefs();
if(token)startApp();

// v8 interaction guards
$('#chatProfileOpen').onclick=()=>{ if(!supportMode)openChatProfile(); };
$('#messageInput').oninput=()=>{
  if(supportMode)return;
  if(!socket)return; socket.emit('typing',{isTyping:true,peerId:currentPeer||null}); clearTimeout(typingTimer); typingTimer=setTimeout(()=>socket.emit('typing',{isTyping:false,peerId:currentPeer||null}),850);
};

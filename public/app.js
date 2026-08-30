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
  rememberAccount(me,token);
  renderAccounts();
}

function updateChatHeader(participantCount){
  if(currentPeer && currentPeerUser){
    $('#chatTitle').innerHTML='@'+escapeHtml(currentPeerUser.username)+badge(currentPeerUser);
    $('#chatSubtitle').textContent=currentPeerUser.online?(lang==='ru'?'онлайн':'online'):(lang==='ru'?'личные сообщения':'direct messages');
  }else{
    $('#chatTitle').innerHTML='205chat <span class="check orange-check">✓</span>';
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
  copy.innerHTML=`<b>@${escapeHtml(u.username)}${badge(u)}</b><span>${u.online?(lang==='ru'?'онлайн':'online'):escapeHtml(u.phone||'')}</span>`;
  av.onclick=e=>{e.stopPropagation();openUserProfile(u)}; b.append(av,copy); b.onclick=()=>openPeer(u); return b;
}
function renderContacts(){ const box=$('#contactsList'); box.innerHTML=''; contacts.forEach(u=>box.appendChild(contactRow(u))); }
async function loadContacts(){ try{ const d=await api('/api/contacts'); contacts=d.contacts||[]; if(currentPeer)currentPeerUser=contacts.find(x=>x.id===currentPeer)||currentPeerUser; renderContacts(); updateChatHeader(); }catch(err){toast(err.message)} }
async function openPeer(u){ currentPeer=u.id; currentPeerUser=u; replyTo=null; clearReply(); $('#sidebar').classList.remove('mobile-open'); $('#globalChat').classList.remove('active'); renderContacts(); updateChatHeader(); await loadMessages(); }
$('#globalChat').onclick=async()=>{ currentPeer=null; currentPeerUser=null; replyTo=null; clearReply(); $('#globalChat').classList.add('active'); $('#sidebar').classList.remove('mobile-open'); renderContacts(); await refreshStats(); await loadMessages(); };
$('#addContactBtn').onclick=()=>openModal('contactModal');
$('#contactForm').onsubmit=async e=>{ e.preventDefault(); try{ const d=await api('/api/contacts',{method:'POST',body:JSON.stringify({query:$('#contactQuery').value})}); $('#contactQuery').value=''; closeModal('contactModal'); await loadContacts(); await openPeer(d.contact); toast(lang==='ru'?'Контакт добавлен':'Contact added'); }catch(err){toast(err.message)} };

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
  bubble.innerHTML=`<button class="name name-button">${escapeHtml(m.sender?.username||'Пользователь')}${badge(m.sender)}</button>${replyMarkup(m)}${body}${m.anonymousRealSender?`<div class="anon-real">@${escapeHtml(m.anonymousRealSender.username)} · ${escapeHtml(m.anonymousRealSender.phone)}</div>`:''}${reactionsMarkup(m)}<div class="message-meta"><span>${formatTime(m.createdAt)}</span><span class="message-views"><span class="eye-icon">◉</span><span class="view-count">${m.views||0}</span></span><button class="more-btn" aria-label="More">⋯</button></div>`;
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
function openMessageMenu(anchor,m){
  closeFloating();
  const menu=$('#messageMenu');
  const items=[
    {label:lang==='ru'?'Ответить':'Reply',run:()=>setReply(m)},
    {label:lang==='ru'?'Поставить реакцию':'React',run:()=>openReactionPicker(anchor,m)},
    {label:lang==='ru'?'Удалить у себя':'Delete for me',danger:true,run:()=>socket?.emit('delete-message-self',m.id)}
  ];
  if(me?.isAdmin){
    items.push({label:m.pinned?(lang==='ru'?'Открепить':'Unpin'):(lang==='ru'?'Закрепить':'Pin'),run:()=>socket?.emit('pin-message',m.id)});
    items.push({label:lang==='ru'?'Удалить у всех':'Delete for everyone',danger:true,run:()=>socket?.emit('delete-message-all',m.id)});
  }
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

function setRecordMode(mode){ if(mediaRecorder?.state==='recording')return; recordMode=mode; $('#modeVoice').classList.toggle('active',mode==='voice'); $('#modeVideo').classList.toggle('active',mode==='video'); $('#recordBtn').title=mode==='voice'?(lang==='ru'?'Записать голосовое':'Record voice'):(lang==='ru'?'Записать видео-квадрат':'Record square video'); }
$('#modeVoice').onclick=()=>setRecordMode('voice'); $('#modeVideo').onclick=()=>setRecordMode('video');

function updateRecordClock(){
  const sec=Math.floor((Date.now()-recordStarted)/1000);
  const text=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  $('#recordTime').textContent=text; $('#videoTime').textContent=text;
  if(recordMode==='video'&&sec>=59)stopRecording(true);
}
async function startRecording(){
  if(mediaRecorder?.state==='recording')return stopRecording(true);
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)return toast(lang==='ru'?'Браузер не поддерживает запись':'Recording is not supported');
  try{
    recordCanceled=false; recordChunks=[];
    recordStream=await navigator.mediaDevices.getUserMedia(recordMode==='video'?{audio:true,video:{facingMode:'user',width:{ideal:720},height:{ideal:720}}}:{audio:true});
    let options={};
    const preferred=recordMode==='video'?['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['audio/webm;codecs=opus','audio/webm'];
    const mime=preferred.find(x=>MediaRecorder.isTypeSupported?.(x)); if(mime)options.mimeType=mime;
    mediaRecorder=new MediaRecorder(recordStream,options);
    mediaRecorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data)};
    mediaRecorder.onerror=()=>toast(lang==='ru'?'Ошибка записи':'Recording error');
    mediaRecorder.onstop=finishRecording;
    mediaRecorder.start(250); recordStarted=Date.now(); recordTimer=setInterval(updateRecordClock,250); updateRecordClock();
    $('#recordBtn').textContent='■'; $('#recordBtn').classList.add('recording');
    if(recordMode==='voice'){
      $('#recordLabel').textContent=lang==='ru'?'Запись голосового…':'Recording voice…'; $('#recordingBar').classList.remove('hidden');
    }else{
      $('#cameraPreview').srcObject=recordStream; $('#videoRecorder').classList.remove('hidden');
    }
  }catch(err){ console.error(err); toast(lang==='ru'?'Разреши доступ к микрофону/камере':'Allow microphone/camera access'); stopTracks(); }
}
function stopTracks(){ if(recordStream){recordStream.getTracks().forEach(t=>t.stop());recordStream=null} $('#cameraPreview').srcObject=null; }
function stopRecording(sendIt){
  if(mediaRecorder?.state!=='recording')return;
  recordCanceled=!sendIt;
  mediaRecorder.stop();
}
async function finishRecording(){
  clearInterval(recordTimer); recordTimer=null;
  $('#recordingBar').classList.add('hidden'); $('#videoRecorder').classList.add('hidden'); $('#recordBtn').textContent='●'; $('#recordBtn').classList.remove('recording');
  const wasMode=recordMode; const chunks=[...recordChunks]; const mime=mediaRecorder?.mimeType||(wasMode==='video'?'video/webm':'audio/webm');
  stopTracks(); mediaRecorder=null; recordChunks=[];
  if(recordCanceled||!chunks.length){recordCanceled=false;return;}
  try{
    toast(lang==='ru'?'Отправка записи…':'Sending recording…');
    const blob=new Blob(chunks,{type:mime}); const ext=mime.includes('mp4')?'mp4':'webm'; const file=new File([blob],`${wasMode==='video'?'square':'voice'}-${Date.now()}.${ext}`,{type:mime});
    const up=await uploadFile(file);
    socket?.emit('send-message',{type:wasMode==='video'?'video':'audio',mediaUrl:up.url,fileName:up.name,mime:up.mime,recipientId:currentPeer||null,replyTo:replyTo?.id||null});
    clearReply();
  }catch(err){toast(err.message)}
}
$('#recordBtn').onclick=()=>mediaRecorder?.state==='recording'?stopRecording(true):startRecording();
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
async function openAdmin(){
  try{
    const d=await api('/api/admin/users'); const tb=$('#usersTable'); tb.innerHTML='';
    d.users.forEach(u=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><b>@${escapeHtml(u.username)}</b> ${badge(u)}${u.isAdmin?'<br><small>Admin</small>':''}</td><td>${escapeHtml(u.phone)}</td><td><span class="status"><span class="dot ${u.online?'on':''}"></span>${u.online?(lang==='ru'?'онлайн':'online'):(lang==='ru'?'оффлайн':'offline')}</span></td><td><button class="verify-btn ${u.verified?'on':''}" data-id="${u.id}" data-v="${u.verified}" ${u.rootAdmin?'disabled':''}>${u.verified?'✓':'+'}</button></td><td><button class="admin-role-btn ${u.isAdmin?'on':''}" data-admin-id="${u.id}" data-a="${u.isAdmin}" ${u.rootAdmin?'disabled':''}>${u.isAdmin?'Admin':'User'}</button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll('.verify-btn:not([disabled])').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/users/'+b.dataset.id+'/verified',{method:'PATCH',body:JSON.stringify({verified:b.dataset.v!=='true'})});await openAdmin()}catch(err){toast(err.message)}});
    tb.querySelectorAll('.admin-role-btn:not([disabled])').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/users/'+b.dataset.adminId+'/admin',{method:'PATCH',body:JSON.stringify({isAdmin:b.dataset.a!=='true'})});await openAdmin()}catch(err){toast(err.message)}});
    openModal('adminModal');
  }catch(err){toast(err.message)}
}
$('#adminBtn').onclick=openAdmin;

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

applyPrefs();
if(token)startApp();

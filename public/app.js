const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
let token = localStorage.getItem('205token');
let me = null, socket = null, typingTimer = null, pendingMedia = null;
let mediaRecorder = null, recordChunks = [], recordTimer = null, recordStarted = 0;
let pendingAvatarFile = null;

const I18N = {
  ru: {
    'auth.subtitle':'Общий чат без лишнего шума.','auth.login':'Вход','auth.register':'Регистрация','auth.usernameOrPhone':'Username или номер телефона','auth.password':'Пароль','auth.phone':'Номер телефона','auth.submitLogin':'Войти','auth.submitRegister':'Создать аккаунт',
    'common.search':'Поиск','common.logout':'Выйти','common.cancel':'Отмена','common.save':'Сохранить','chat.global':'Общий чат','chat.subtitle':'общий чат · покинуть нельзя','chat.message':'Сообщение','chat.anonymous':'Анонимно','chat.recording':'Запись голосового…',
    'settings.title':'Настройки','settings.subtitle':'Внешний вид и язык','settings.theme':'Тема','settings.themeHint':'Светлая или тёмная','settings.dark':'Тёмная','settings.light':'Светлая','settings.language':'Язык',
    'profile.title':'Профиль','profile.subtitle':'Данные аккаунта','profile.accounts':'Аккаунты','profile.addAccount':'+ Добавить аккаунт','profile.addHint':'Войдите в существующий аккаунт','profile.switch':'Переключить','profile.current':'Сейчас',
    'photo.title':'Проверь фото','photo.subtitle':'Оно будет отображаться в профиле','photo.good':'Выглядит хорошо','photo.new':'Выбрать другое фото',
    'admin.title':'Панель администратора','admin.subtitle':'Пользователи 205chating','admin.passwordNotice':'Пароли не отображаются: сервер хранит только защищённые bcrypt-хеши.','admin.user':'Пользователь','admin.phone':'Телефон','admin.status':'Статус','admin.verified':'Галочка'
  },
  en: {
    'auth.subtitle':'A shared chat without the noise.','auth.login':'Log in','auth.register':'Register','auth.usernameOrPhone':'Username or telephone number','auth.password':'Password','auth.phone':'Telephone number','auth.submitLogin':'Log in','auth.submitRegister':'Create account',
    'common.search':'Search','common.logout':'Log out','common.cancel':'Cancel','common.save':'Save','chat.global':'Global chat','chat.subtitle':'global chat · cannot be left','chat.message':'Message','chat.anonymous':'Anonymous','chat.recording':'Recording voice…',
    'settings.title':'Settings','settings.subtitle':'Appearance and language','settings.theme':'Theme','settings.themeHint':'Light or dark','settings.dark':'Dark','settings.light':'Light','settings.language':'Language',
    'profile.title':'Profile','profile.subtitle':'Account details','profile.accounts':'Accounts','profile.addAccount':'+ Add account','profile.addHint':'Log in to an existing account','profile.switch':'Switch','profile.current':'Current',
    'photo.title':'Review Your Photo','photo.subtitle':'This will appear in your profile','photo.good':'Looks Good','photo.new':'Choose another photo',
    'admin.title':'Admin panel','admin.subtitle':'205chating users','admin.passwordNotice':'Passwords are not shown: the server stores only protected bcrypt hashes.','admin.user':'User','admin.phone':'Phone','admin.status':'Status','admin.verified':'Verified'
  }
};
let lang = localStorage.getItem('205lang') || 'ru';
let theme = localStorage.getItem('205theme') || 'dark';

function t(k){ return I18N[lang]?.[k] || I18N.ru[k] || k; }
function applyPrefs(){
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  $$('[data-i18n-placeholder]').forEach(el => el.placeholder = t(el.dataset.i18nPlaceholder));
  $('#themeDark').classList.toggle('active', theme === 'dark');
  $('#themeLight').classList.toggle('active', theme === 'light');
  $('#langRu').classList.toggle('active', lang === 'ru');
  $('#langEn').classList.toggle('active', lang === 'en');
  renderAccounts();
}
function toast(text){ const e=$('#toast'); e.textContent=text; e.classList.add('show'); clearTimeout(e._timer); e._timer=setTimeout(()=>e.classList.remove('show'),2300); }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function initials(u){ return String(u?.username || '205').slice(0,2).toUpperCase(); }
function badge(u){ return (u?.verified || u?.isAdmin) ? '<span class="check">✓</span>' : ''; }
function setAvatar(el, user){ if(!el) return; el.textContent = user?.avatarUrl ? '' : initials(user); el.style.backgroundImage = user?.avatarUrl ? `url("${user.avatarUrl}")` : ''; }

async function api(url,opt={}){
  const headers = {...(token ? {Authorization:`Bearer ${token}`} : {}), ...(opt.headers||{})};
  if (!(opt.body instanceof FormData)) headers['Content-Type']='application/json';
  const r = await fetch(url,{...opt,headers});
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
function accounts(){ try{return JSON.parse(localStorage.getItem('205accounts')||'[]')}catch{return []} }
function saveAccounts(a){ localStorage.setItem('205accounts',JSON.stringify(a.slice(0,8))); }
function rememberAccount(user,newToken){
  let a=accounts().filter(x=>x.id!==user.id);
  a.unshift({id:user.id,username:user.username,phone:user.phone,avatarUrl:user.avatarUrl||'',token:newToken});
  saveAccounts(a);
}
function setSession(newToken,user){ token=newToken; me=user; localStorage.setItem('205token',newToken); rememberAccount(user,newToken); }
function clearSession(){ localStorage.removeItem('205token'); location.reload(); }

$$('.auth-tab').forEach(b=>b.onclick=()=>{ $$('.auth-tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $$('.auth-form').forEach(x=>x.classList.remove('active')); $('#'+b.dataset.tab+'Form').classList.add('active'); });
$('#registerForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/register',{method:'POST',body:JSON.stringify({phone:$('#phone').value,username:$('#username').value,password:$('#password').value})});setSession(d.token,d.user);startApp();}catch(err){toast(err.message)}};
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#login').value,password:$('#loginPassword').value})});setSession(d.token,d.user);startApp();}catch(err){toast(err.message)}};
$('#logout').onclick=clearSession;

function syncMeUI(){
  if(!me)return;
  $('#meName').innerHTML='@'+escapeHtml(me.username)+badge(me);
  $('#mePhone').textContent=me.phone;
  $('#profileName').innerHTML='@'+escapeHtml(me.username)+badge(me);
  $('#profilePhone').textContent=me.phone;
  $('#profileUsername').value=me.username;
  setAvatar($('#meAvatar'),me); setAvatar($('#mobileProfile'),me); setAvatar($('#avatarButton'),me);
  $('#adminBtn').classList.toggle('hidden',!me.isAdmin);
  rememberAccount(me,token); renderAccounts();
}

function renderMessage(m){
  const row=document.createElement('div'); row.className='msg'+(m.mine?' mine':''); row.dataset.id=m.id;
  const av=document.createElement('div'); av.className='avatar msg-avatar'; setAvatar(av,m.sender);
  const bubble=document.createElement('div'); bubble.className='bubble';
  const time=new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  let body='';
  if(m.type==='image') body=`<img class="media-image" src="${escapeHtml(m.mediaUrl)}" alt="image">`;
  else if(m.type==='video') body=`<video class="media-video" src="${escapeHtml(m.mediaUrl)}" controls playsinline></video>`;
  else if(m.type==='audio') body=`<audio class="media-audio" src="${escapeHtml(m.mediaUrl)}" controls preload="metadata"></audio>`;
  if(m.text) body += `<div class="text${m.type!=='text'?' caption':''}">${escapeHtml(m.text)}</div>`;
  bubble.innerHTML=`<div class="name">${escapeHtml(m.sender.username)}${badge(m.sender)}</div>${body}${m.anonymousRealSender?`<div class="anon-real">@${escapeHtml(m.anonymousRealSender.username)} · ${escapeHtml(m.anonymousRealSender.phone)}</div>`:''}<div class="meta">${time}${m.mine||me.isAdmin?`<button class="del" title="Delete">×</button>`:''}</div>`;
  const del=bubble.querySelector('.del'); if(del)del.onclick=()=>socket?.emit('delete-message',m.id);
  row.append(av,bubble); $('#messages').appendChild(row); $('#messages').scrollTop=$('#messages').scrollHeight;
  $('#lastPreview').textContent=(m.type==='text'?`${m.sender.username}: ${m.text}`:`${m.sender.username}: ${m.type}`).slice(0,44);
}
async function loadMessages(){ const d=await api('/api/messages'); $('#messages').innerHTML=''; d.messages.forEach(renderMessage); }
function connect(){
  socket?.disconnect();
  socket=io({auth:{token}});
  socket.on('connect_error',()=>toast(lang==='ru'?'Ошибка подключения':'Connection error'));
  socket.on('message',renderMessage);
  socket.on('message-deleted',id=>document.querySelector(`.msg[data-id="${id}"]`)?.remove());
  socket.on('typing',x=>{if(x.userId===me.id)return;$('#typing').textContent=x.isTyping?`@${x.username} ${lang==='ru'?'печатает…':'is typing…'}`:''});
  socket.on('user-updated',u=>{if(u.id===me.id){me={...me,...u};syncMeUI()} });
}
function send(){ const text=$('#messageInput').value.trim(); if(!socket)return; if(pendingMedia){ socket.emit('send-message',{text,type:pendingMedia.type,mediaUrl:pendingMedia.url,fileName:pendingMedia.name,mime:pendingMedia.mime,anonymous:$('#anonymous').checked}); clearPendingMedia(); $('#messageInput').value=''; return; } if(!text)return; socket.emit('send-message',{text,type:'text',anonymous:$('#anonymous').checked}); $('#messageInput').value=''; socket.emit('typing',false); }
$('#send').onclick=send;
$('#messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
$('#messageInput').oninput=()=>{if(!socket)return;socket.emit('typing',true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('typing',false),850)};

async function uploadFile(file){ const fd=new FormData(); fd.append('file',file,file.name||'recording.webm'); return api('/api/upload',{method:'POST',body:fd}); }
function clearPendingMedia(){ pendingMedia=null; $('#uploadPreview').classList.add('hidden'); $('#uploadPreview').innerHTML=''; $('#mediaInput').value=''; }
function showPendingMedia(data,file){ pendingMedia=data; const p=$('#uploadPreview'); let visual=''; if(data.type==='image') visual=`<img src="${URL.createObjectURL(file)}">`; if(data.type==='video') visual=`<video src="${URL.createObjectURL(file)}"></video>`; p.innerHTML=`${visual}<span>${escapeHtml(file.name||data.name||data.type)}</span><button class="text-btn" id="removePending">×</button>`; p.classList.remove('hidden'); $('#removePending').onclick=clearPendingMedia; }
$('#attachBtn').onclick=()=>$('#mediaInput').click();
$('#mediaInput').onchange=async()=>{ const file=$('#mediaInput').files[0]; if(!file)return; try{toast(lang==='ru'?'Загрузка…':'Uploading…'); const data=await uploadFile(file); showPendingMedia(data,file);}catch(err){toast(err.message);clearPendingMedia()} };

$('#voiceBtn').onclick=async()=>{ if(mediaRecorder?.state==='recording'){stopRecording();return;} try{ const stream=await navigator.mediaDevices.getUserMedia({audio:true}); recordChunks=[]; mediaRecorder=new MediaRecorder(stream); mediaRecorder.ondataavailable=e=>{if(e.data.size)recordChunks.push(e.data)}; mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop()); const blob=new Blob(recordChunks,{type:mediaRecorder.mimeType||'audio/webm'}); const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type}); try{const up=await uploadFile(file);socket.emit('send-message',{type:'audio',mediaUrl:up.url,fileName:up.name,mime:up.mime,anonymous:$('#anonymous').checked});}catch(err){toast(err.message)};}; mediaRecorder.start(250); recordStarted=Date.now(); $('#recordingBar').classList.remove('hidden'); updateRecordTime(); recordTimer=setInterval(updateRecordTime,500); }catch{toast(lang==='ru'?'Разреши доступ к микрофону':'Allow microphone access')} };
function updateRecordTime(){const sec=Math.floor((Date.now()-recordStarted)/1000);$('#recordTime').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
function stopRecording(){ if(mediaRecorder?.state==='recording')mediaRecorder.stop(); clearInterval(recordTimer); $('#recordingBar').classList.add('hidden'); }
$('#cancelRecord').onclick=()=>{ if(mediaRecorder?.state==='recording'){ mediaRecorder.onstop=()=>mediaRecorder.stream?.getTracks().forEach(t=>t.stop()); mediaRecorder.stop(); } clearInterval(recordTimer); $('#recordingBar').classList.add('hidden'); };

function openModal(id){ $('#'+id).classList.remove('hidden'); }
function closeModal(id){ $('#'+id).classList.add('hidden'); }
$$('.modal-close').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.add('hidden')}));
$('#openSettings').onclick=$('#mobileSettings').onclick=()=>openModal('settingsModal');
$('#openProfile').onclick=$('#mobileProfile').onclick=()=>{syncMeUI();openModal('profileModal')};
$('#themeDark').onclick=()=>{theme='dark';localStorage.setItem('205theme',theme);applyPrefs()};
$('#themeLight').onclick=()=>{theme='light';localStorage.setItem('205theme',theme);applyPrefs()};
$('#langRu').onclick=()=>{lang='ru';localStorage.setItem('205lang',lang);applyPrefs()};
$('#langEn').onclick=()=>{lang='en';localStorage.setItem('205lang',lang);applyPrefs()};

$('#saveUsername').onclick=async()=>{try{const d=await api('/api/profile',{method:'PATCH',body:JSON.stringify({username:$('#profileUsername').value})});me=d.user;syncMeUI();toast(lang==='ru'?'Username обновлён':'Username updated')}catch(err){toast(err.message)}};
$('#avatarButton').onclick=()=>$('#avatarInput').click();
$('#avatarInput').onchange=()=>{const file=$('#avatarInput').files[0];if(!file)return;pendingAvatarFile=file;$('#avatarPreviewImg').src=URL.createObjectURL(file);closeModal('profileModal');openModal('avatarReview')};
$('#chooseAnotherAvatar').onclick=()=>$('#avatarInput').click();
$('#confirmAvatar').onclick=async()=>{if(!pendingAvatarFile)return;try{const fd=new FormData();fd.append('avatar',pendingAvatarFile);const d=await api('/api/profile/avatar',{method:'POST',body:fd});me=d.user;syncMeUI();pendingAvatarFile=null;closeModal('avatarReview');openModal('profileModal');toast(lang==='ru'?'Фото профиля обновлено':'Profile photo updated')}catch(err){toast(err.message)}};

function renderAccounts(){ const box=$('#accountList'); if(!box)return; const a=accounts(); box.innerHTML=''; a.forEach(acc=>{const row=document.createElement('div');row.className='account-row';const av=document.createElement('div');av.className='avatar';setAvatar(av,acc);const copy=document.createElement('div');copy.className='account-copy';copy.innerHTML=`<b>@${escapeHtml(acc.username)}</b><span>${escapeHtml(acc.phone||'')}</span>`;const b=document.createElement('button');b.className='account-switch';const current=me?.id===acc.id;b.textContent=current?t('profile.current'):t('profile.switch');b.disabled=current;b.onclick=()=>switchAccount(acc);row.append(av,copy,b);box.appendChild(row)}); }
async function switchAccount(acc){ try{token=acc.token;localStorage.setItem('205token',token);const d=await api('/api/me');me=d.user;rememberAccount(me,token);syncMeUI();closeModal('profileModal');await loadMessages();connect();}catch{let a=accounts().filter(x=>x.id!==acc.id);saveAccounts(a);renderAccounts();toast(lang==='ru'?'Сессия аккаунта истекла':'Account session expired')} }
$('#addAccount').onclick=()=>openModal('accountModal');
$('#accountLoginForm').onsubmit=async e=>{e.preventDefault();try{const oldToken=token,oldMe=me;token=null;const d=await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#accountLogin').value,password:$('#accountPassword').value})});token=oldToken;me=oldMe;rememberAccount(d.user,d.token);closeModal('accountModal');renderAccounts();toast(lang==='ru'?'Аккаунт добавлен':'Account added')}catch(err){toast(err.message)} };

async function openAdmin(){try{const d=await api('/api/admin/users');const tb=$('#usersTable');tb.innerHTML='';d.users.forEach(u=>{const tr=document.createElement('tr');tr.innerHTML=`<td><b>@${escapeHtml(u.username)}</b> ${badge(u)}${u.isAdmin?'<br><small>Admin</small>':''}</td><td>${escapeHtml(u.phone)}</td><td><span class="status"><span class="dot ${u.online?'on':''}"></span>${u.online?(lang==='ru'?'онлайн':'online'):(lang==='ru'?'оффлайн':'offline')}</span></td><td>${u.isAdmin?'—':`<button class="verify-btn ${u.verified?'on':''}" data-id="${u.id}" data-v="${u.verified}">${u.verified?'✓':'+'}</button>`}</td>`;tb.appendChild(tr)});tb.querySelectorAll('.verify-btn').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/users/'+b.dataset.id+'/verified',{method:'PATCH',body:JSON.stringify({verified:b.dataset.v!=='true'})});openAdmin()}catch(err){toast(err.message)}});openModal('adminModal')}catch(err){toast(err.message)}}
$('#adminBtn').onclick=openAdmin;

async function startApp(){ try{ if(!me){const d=await api('/api/me');me=d.user} $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); syncMeUI(); await loadMessages(); connect(); }catch{localStorage.removeItem('205token');token=null;$('#auth').classList.remove('hidden');$('#app').classList.add('hidden')} }

applyPrefs();
if(token)startApp();

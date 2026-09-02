// ========================= 205chating 0.1.8v — virtual stocks =========================
let stockMarket = [];
let stockWallet = null;
let selectedStock = null;
let stockWalletReturnToSettings = false;

const stockFmt = n => {
  const v = Number(n) || 0;
  if(v >= 1000) return v.toLocaleString('ru-RU',{maximumFractionDigits:2});
  if(v >= 1) return v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});
  return v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});
};
const stockGrowthClass = n => Number(n)>0?'up':Number(n)<0?'down':'flat';
const stockGrowthText = n => `${Number(n)>0?'+':''}${Number(n||0).toFixed(2).replace('.',',')}%`;
function stockAvatar(el, stock){
  if(!el)return;
  el.textContent=stock?.avatarUrl?'':String(stock?.name||'↗').slice(0,2).toUpperCase();
  el.style.backgroundImage=stock?.avatarUrl?`url("${stock.avatarUrl}")`:'';
}
function stockVerify(stock){return stock?.verified?'<span class="stock-check" title="Проверенная акция">✓</span>':''}
function stockSparkline(history=[]){
  const rows=(history||[]).slice(-32);if(rows.length<2)return '<div class="stock-spark-empty"></div>';
  const vals=rows.map(x=>Number(x.price)||.01),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(.0001,max-min);
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*100},${34-((v-min)/span)*30}`).join(' ');
  return `<svg class="stock-sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}
function closeStockPages(){
  $('#stockMarketPage')?.classList.add('hidden');
  $('#stockWalletPage')?.classList.add('hidden');
}
function updateStockWalletSetting(){
  const opened=!!(stockWallet?.opened ?? me?.stockWalletOpened);
  $('#stockWalletStatus') && ($('#stockWalletStatus').textContent=opened?'Открыт':'Не открыт');
  $('#stockWalletStatus')?.classList.toggle('opened',opened);
  $('#openStockWallet') && ($('#openStockWallet').textContent=opened?'Перейти':'Открыть');
}

async function loadStockMarket({silent=false}={}){
  if(!token)return;
  try{
    const d=await api('/api/stocks/market');
    stockMarket=d.stocks||[];
    if(me){me.strawberries=d.balance;me.stockWalletOpened=!!d.walletOpened;syncMeUI?.()}
    $('#stockMarketBalance') && ($('#stockMarketBalance').textContent=`${stockFmt(d.balance)}🍓`);
    updateStockWalletSetting();
    renderStockMarket();
    if(selectedStock){const fresh=stockMarket.find(s=>s.id===selectedStock.id);if(fresh){selectedStock=fresh;renderStockDetail()}}
  }catch(e){if(!silent)toast(e.message)}
}
function sortedStocks(){
  const mode=$('#stockSort')?.value||'growth';
  const arr=[...stockMarket];
  if(mode==='price_desc')arr.sort((a,b)=>b.price-a.price);
  else if(mode==='price_asc')arr.sort((a,b)=>a.price-b.price);
  else if(mode==='newest')arr.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  else arr.sort((a,b)=>b.growth1h-a.growth1h || b.volume1h-a.volume1h);
  return arr;
}
function renderStockMarket(){
  const box=$('#stockMarketGrid');if(!box)return;box.innerHTML='';
  const canCreate=!!me?.premium;
  const create=$('#createStockBtn');if(create){create.textContent=canCreate?'＋ Создать акцию':'Создать акцию · Premium';create.classList.toggle('premium-locked',!canCreate)}
  sortedStocks().forEach(stock=>{
    const card=document.createElement('button');card.className='stock-card';card.type='button';
    card.innerHTML=`<div class="stock-card-head"><div class="stock-avatar"></div><div><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span>@${escapeHtml(stock.creator?.username||'user')}</span></div></div><div class="stock-card-price"><b>${stockFmt(stock.price)}🍓</b><span class="stock-growth ${stockGrowthClass(stock.growth1h)}">${stockGrowthText(stock.growth1h)} · 1ч</span></div>${stockSparkline(stock.history)}<div class="stock-card-foot"><span>${stock.circulating} в обороте</span><span>${stock.forecast}</span></div>`;
    stockAvatar(card.querySelector('.stock-avatar'),stock);card.onclick=()=>openStockDetail(stock.id);box.appendChild(card);
  });
  if(!box.children.length)box.innerHTML='<div class="stock-empty"><div>↗</div><b>Рынок пока пуст</b><span>Первая Premium-акция начнёт с цены 0,01🍓.</span></div>';
}
async function openStockMarket(){
  $('#sideMenu')?.classList.add('hidden');$('#sidebar')?.classList.remove('mobile-open');$('#settingsPage')?.classList.add('hidden');$('#stockWalletPage')?.classList.add('hidden');
  $('#stockMarketPage')?.classList.remove('hidden');await loadStockMarket();
}

async function loadStockWallet(){
  if(!token)return;
  try{
    const d=await api('/api/stocks/wallet');stockWallet=d;
    if(me){me.strawberries=d.balance;me.stockWalletOpened=!!d.opened;syncMeUI?.()}
    $('#stockWalletBalance') && ($('#stockWalletBalance').textContent=`${stockFmt(d.balance)}🍓`);
    $('#stockWalletGate')?.classList.toggle('hidden',!!d.opened);$('#stockWalletContent')?.classList.toggle('hidden',!d.opened);
    updateStockWalletSetting();if(d.opened)renderStockWallet();
  }catch(e){toast(e.message)}
}
function renderStockWallet(){
  if(!stockWallet)return;
  const holdings=stockWallet.holdings||[],created=stockWallet.created||[];
  const totalValue=holdings.reduce((a,s)=>a+(Number(s.value)||0),0);
  const summary=$('#stockPortfolioSummary');if(summary)summary.innerHTML=`<div><span>Акций в портфеле</span><b>${holdings.reduce((a,s)=>a+(s.qty||0),0)}</b></div><div><span>Стоимость портфеля</span><b>${stockFmt(totalValue)}🍓</b></div><div><span>Баланс</span><b>${stockFmt(stockWallet.balance)}🍓</b></div>`;
  const list=$('#stockPortfolioList');if(list){list.innerHTML='';holdings.forEach(stock=>{const row=document.createElement('button');row.type='button';row.className='stock-list-row';row.innerHTML=`<div class="stock-avatar"></div><div class="stock-list-copy"><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span>${stock.qty} шт. · ${stockFmt(stock.value)}🍓</span></div><div class="stock-list-price"><b>${stockFmt(stock.price)}🍓</b><span class="stock-growth ${stockGrowthClass(stock.growth1h)}">${stockGrowthText(stock.growth1h)}</span></div>`;stockAvatar(row.querySelector('.stock-avatar'),stock);row.onclick=()=>openStockDetail(stock.id);list.appendChild(row)});if(!list.children.length)list.innerHTML='<div class="stock-empty compact"><b>Портфель пуст</b><span>Открой рынок и выбери первую акцию.</span><button id="walletGoMarket" class="secondary">Перейти на рынок</button></div>';list.querySelector('#walletGoMarket')?.addEventListener('click',e=>{e.stopPropagation();openStockMarket()})}
  const mine=$('#myCreatedStocks');if(mine){mine.innerHTML='';created.forEach(stock=>{const row=document.createElement('button');row.type='button';row.className='stock-list-row creator-stock-row';row.innerHTML=`<div class="stock-avatar"></div><div class="stock-list-copy"><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span>${stock.circulating} в обороте · ${stock.forecast}</span></div><div class="stock-list-price"><b>${stockFmt(stock.price)}🍓</b><span class="stock-growth ${stockGrowthClass(stock.growth1h)}">${stockGrowthText(stock.growth1h)}</span></div>`;stockAvatar(row.querySelector('.stock-avatar'),stock);row.onclick=()=>openStockDetail(stock.id);mine.appendChild(row)});if(!mine.children.length)mine.innerHTML='<div class="stock-empty compact"><b>Своих акций пока нет</b><span>Premium позволяет выпустить до 3 акций.</span></div>'}
  const create=$('#createStockFromWallet');if(create){create.disabled=!me?.premium||created.length>=Number(stockWallet.maxCreated||3);create.title=!me?.premium?'Нужен Chatics Premium':created.length>=Number(stockWallet.maxCreated||3)?'Лимит 3 акции':''}
}
async function openStockWallet({fromSettings=false}={}){
  stockWalletReturnToSettings=fromSettings;$('#settingsPage')?.classList.add('hidden');$('#stockMarketPage')?.classList.add('hidden');$('#stockWalletPage')?.classList.remove('hidden');await loadStockWallet();
}
async function activateStockWallet(){
  try{const d=await api('/api/stocks/wallet/open',{method:'POST'});if(me){me.stockWalletOpened=true;syncMeUI?.()}toast('Кошелёк акций открыт');await loadStockWallet();}catch(e){toast(e.message)}
}

function drawStockDetailChart(history=[]){
  const c=$('#stockDetailChart');if(!c)return;const ctx=c.getContext('2d'),rows=(history||[]).slice(-100),w=c.width,h=c.height,p=28;ctx.clearRect(0,0,w,h);
  const line=getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#273149',accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#2f7cff',muted=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#8d96a8';
  ctx.strokeStyle=line;ctx.lineWidth=1;for(let i=0;i<4;i++){const y=p+(h-p*2)*i/3;ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}
  if(!rows.length)return;const vals=rows.map(x=>Number(x.price)||.01),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(.0001,max-min);ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();rows.forEach((r,i)=>{const x=p+(w-p*2)*(i/Math.max(1,rows.length-1)),y=h-p-(h-p*2)*((Number(r.price)-min)/span);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle=muted;ctx.font='12px sans-serif';ctx.fillText(`${stockFmt(max)}🍓`,4,p+4);ctx.fillText(`${stockFmt(min)}🍓`,4,h-p+4);
}
async function openStockDetail(id){
  const stock=stockMarket.find(s=>s.id===id)||(stockWallet?.holdings||[]).find(s=>s.id===id)||(stockWallet?.created||[]).find(s=>s.id===id);if(!stock)return;
  selectedStock=stock;renderStockDetail();openModal('stockDetailModal');
}
function renderStockDetail(){
  const s=selectedStock;if(!s)return;$('#stockDetailName').innerHTML=`${escapeHtml(s.name)} ${stockVerify(s)}`;$('#stockDetailCreator').textContent=`Создатель: @${s.creator?.username||'user'}`;stockAvatar($('#stockDetailAvatar'),s);$('#stockDetailPrice').textContent=`${stockFmt(s.price)}🍓`;const g=$('#stockDetailGrowth');g.className=`stock-growth ${stockGrowthClass(s.growth1h)}`;g.textContent=`${stockGrowthText(s.growth1h)} за последний час`;$('#stockDetailOwned').textContent=`У вас: ${s.owned||0} шт.`;$('#stockDetailForecast').textContent=`${s.forecast} · объём ${s.volume1h||0}/ч`;drawStockDetailChart(s.history||[]);
  const owner=!!s.mine;$('#stockOwnerTools')?.classList.toggle('hidden',!owner);$('#stockTradeBox')?.classList.toggle('hidden',owner);
  const opened=!!(stockWallet?.opened ?? me?.stockWalletOpened);const buy=$('#buyStockBtn'),sell=$('#sellStockBtn');if(buy){buy.textContent=opened?'Купить':'Открыть кошелёк';buy.disabled=false}if(sell){sell.disabled=!opened||!(s.owned>0)}
}
async function tradeStock(type){
  const s=selectedStock;if(!s)return;const opened=!!(stockWallet?.opened ?? me?.stockWalletOpened);if(!opened){closeModal('stockDetailModal');return openStockWallet()}
  const qty=Math.trunc(Number($('#stockTradeQty')?.value));if(!Number.isFinite(qty)||qty<1)return toast('Укажи количество акций');
  const btn=type==='buy'?$('#buyStockBtn'):$('#sellStockBtn');setBusy?.(btn,true,type==='buy'?'Покупаем…':'Продаём…');
  try{const d=await api(`/api/stocks/${encodeURIComponent(s.id)}/${type}`,{method:'POST',body:JSON.stringify({qty})});if(me){me.strawberries=d.balance;syncMeUI?.()}selectedStock=d.stock;toast(type==='buy'?`Куплено ${qty} акций`:`Продано ${qty} акций`);await Promise.all([loadStockMarket({silent:true}),loadStockWallet()]);renderStockDetail()}catch(e){toast(e.message)}finally{setBusy?.(btn,false)}
}
function requestCreateStock(){
  if(!me?.premium){toast('Создание акций входит в Chatics Premium');return openModal('premiumModal')}
  if(stockWallet?.created?.length>=3)return toast('Можно создать не больше 3 акций');openModal('stockCreateModal');
}
async function createStock(e){
  e.preventDefault();const name=$('#stockCreateName').value.trim(),file=$('#stockCreateAvatar').files[0];if(!file)return toast('Выбери аватарку акции');const fd=new FormData();fd.append('name',name);fd.append('avatar',file);const btn=e.currentTarget.querySelector('button[type="submit"]');setBusy?.(btn,true,'Выпускаем…');try{const d=await api('/api/stocks',{method:'POST',body:fd});if(me){me.stockWalletOpened=true;syncMeUI?.()}e.currentTarget.reset();closeModal('stockCreateModal');toast('Акция вышла на рынок');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()]);if(d.stock)openStockDetail(d.stock.id)}catch(err){toast(err.message)}finally{setBusy?.(btn,false)}}

async function loadAdminStocks(){
  if(!me?.isAdmin)return;try{const d=await api('/api/admin/stocks'),box=$('#adminStocksList');if(!box)return;box.innerHTML='';(d.stocks||[]).forEach(s=>{const row=document.createElement('div');row.className='admin-stock-row';row.innerHTML=`<div class="stock-avatar"></div><div class="admin-stock-copy"><b>${escapeHtml(s.name)} ${stockVerify(s)}</b><span>Создатель: @${escapeHtml(s.creator?.username||'Удалён')} · ${stockFmt(s.price)}🍓 · ${s.circulating} в обороте</span><small>${stockGrowthText(s.growth1h)} за час · ${s.forecast}</small></div><div class="admin-stock-actions"><button class="verify-btn stock-verify">${s.verified?'Снять галочку':'Выдать галочку'}</button><button class="danger-button stock-delete">Удалить</button></div>`;stockAvatar(row.querySelector('.stock-avatar'),s);row.querySelector('.stock-verify').onclick=async()=>{try{await api(`/api/admin/stocks/${encodeURIComponent(s.id)}/verified`,{method:'PATCH',body:JSON.stringify({verified:!s.verified})});await loadAdminStocks();await loadStockMarket({silent:true})}catch(e){toast(e.message)}};row.querySelector('.stock-delete').onclick=async()=>{if(!confirm(`Удалить акцию «${s.name}»? Владельцам будут возвращены клубнички по текущей виртуальной цене.`))return;try{await api(`/api/admin/stocks/${encodeURIComponent(s.id)}`,{method:'DELETE'});toast('Акция удалена');await loadAdminStocks();await loadStockMarket({silent:true})}catch(e){toast(e.message)}};box.appendChild(row)});if(!box.children.length)box.innerHTML='<div class="empty-state">Акций пока нет</div>'}catch(e){toast(e.message)}
}

// Remove the channel product surface from 0.1.8v. Legacy elements stay hidden only so old bundled handlers cannot crash.
currentChannel=null;premiumChannels=[];
if(typeof loadPremiumChannels==='function')loadPremiumChannels=async()=>{premiumChannels=[];currentChannel=null};
if(typeof renderPremiumChannels==='function')renderPremiumChannels=()=>{};
$('#sidebarAddFab') && ($('#sidebarAddFab').onclick=()=>openModal('contactModal'));
$('#fabChoiceModal')?.classList.add('hidden');

// Navigation
$('#sideStocks')?.addEventListener('click',openStockMarket);
$('#closeStockMarket')?.addEventListener('click',()=>$('#stockMarketPage').classList.add('hidden'));
$('#stockSort')?.addEventListener('change',renderStockMarket);
$('#openWalletFromMarket')?.addEventListener('click',()=>openStockWallet());
$('#openStockWallet')?.addEventListener('click',()=>openStockWallet({fromSettings:true}));
$('#closeStockWallet')?.addEventListener('click',()=>{const page=$('#stockWalletPage');page?.classList.add('hidden');if(stockWalletReturnToSettings)$('#settingsPage')?.classList.remove('hidden');stockWalletReturnToSettings=false});
$('#activateStockWallet')?.addEventListener('click',activateStockWallet);
$('#createStockBtn')?.addEventListener('click',requestCreateStock);
$('#createStockFromWallet')?.addEventListener('click',requestCreateStock);
$('#stockCreateForm')?.addEventListener('submit',createStock);
$('#buyStockBtn')?.addEventListener('click',()=>tradeStock('buy'));
$('#sellStockBtn')?.addEventListener('click',()=>tradeStock('sell'));
$('#stockOwnerAvatarInput')?.addEventListener('change',async()=>{const f=$('#stockOwnerAvatarInput').files[0],s=selectedStock;if(!f||!s?.mine)return;const fd=new FormData();fd.append('avatar',f);try{const d=await api(`/api/stocks/${encodeURIComponent(s.id)}/avatar`,{method:'PATCH',body:fd});selectedStock=d.stock;toast('Аватарка акции обновлена');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()]);renderStockDetail()}catch(e){toast(e.message)}});
$('#deleteOwnStockBtn')?.addEventListener('click',async()=>{const s=selectedStock;if(!s?.mine||!confirm(`Удалить акцию «${s.name}»? Владельцам вернутся клубнички по текущей виртуальной цене.`))return;try{await api(`/api/stocks/${encodeURIComponent(s.id)}`,{method:'DELETE'});closeModal('stockDetailModal');selectedStock=null;toast('Акция удалена');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()])}catch(e){toast(e.message)}});
$$('[data-stock-wallet-tab]').forEach(b=>b.addEventListener('click',()=>{$$('[data-stock-wallet-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#stockPortfolioTab')?.classList.toggle('hidden',b.dataset.stockWalletTab!=='portfolio');$('#stockMineTab')?.classList.toggle('hidden',b.dataset.stockWalletTab!=='mine')}));
$('#refreshAdminStocks')?.addEventListener('click',loadAdminStocks);

// Admin stocks tab layered on top of existing tab logic.
if(typeof setAdminTab==='function'){
  const v18AdminTabBase=setAdminTab;
  setAdminTab=function(tab){v18AdminTabBase(tab);$('#adminStocksTab')?.classList.toggle('hidden',tab!=='stocks');if(tab==='stocks')loadAdminStocks()};
  $$('[data-admin-tab]').forEach(b=>b.onclick=()=>setAdminTab(b.dataset.adminTab));
}
// Replace old analytics channel card with stock metrics.
if(typeof loadAnalytics==='function'){
  loadAnalytics=async function(){if(!me?.isAdmin)return;try{const d=await api('/api/admin/analytics');const cards=$('#analyticsCards');cards.innerHTML=[['Сейчас онлайн',d.online],['Пользователей',d.users],['Сообщений',d.messages],['Личных сообщений',d.privateMessages],['Акций',d.stocks],['Сделок акций',d.stockTrades],['Premium',d.premium]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('');drawAnalyticsChart(d.registrations||[])}catch(e){toast(e.message)}};
  $('#refreshAnalytics') && ($('#refreshAnalytics').onclick=loadAnalytics);
}

// Keep wallet status in sync with profile refreshes.
if(typeof syncMeUI==='function'){
  const v18SyncMeBase=syncMeUI;syncMeUI=function(){v18SyncMeBase();updateStockWalletSetting();if($('#stockMarketBalance')&&!$('#stockMarketPage')?.classList.contains('hidden'))$('#stockMarketBalance').textContent=`${stockFmt(me?.strawberries)}🍓`};
}

function attachStockSocket(){
  if(!socket||socket.__stocksV18)return;socket.__stocksV18=true;socket.on('stocks-updated',()=>{loadStockMarket({silent:true});if(!$('#stockWalletPage')?.classList.contains('hidden'))loadStockWallet()});socket.on('balances-updated',async()=>{try{const d=await api('/api/me');me=d.user;syncMeUI()}catch{}})
}
if(typeof connect==='function'){
  const v18ConnectBase=connect;connect=function(){v18ConnectBase();attachStockSocket()};
}

async function stockBoot(){
  if(!token||!me)return;updateStockWalletSetting();attachStockSocket();await loadStockMarket({silent:true});
}
if(typeof startApp==='function'){
  const v18StartBase=startApp;startApp=async function(){await v18StartBase();await stockBoot()};
}
setTimeout(stockBoot,1200);

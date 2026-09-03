// ========================= 205chating 0.2.1v — virtual stocks =========================
let stockMarket = [];
let stockWallet = null;
let selectedStock = null;
let stockWalletReturnToSettings = false;
let stockQuoteTimer = null;
let stockQuoteSeq = 0;
let stockLiveQuote = null;

const stockFmt = n => (Number(n)||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const stockGrowthClass = n => Number(n)>0?'up':Number(n)<0?'down':'flat';
const stockGrowthText = n => `${Number(n)>0?'+':''}${Number(n||0).toFixed(2).replace('.',',')}%`;
function stockAvatar(el, stock){
  if(!el)return;
  el.textContent=stock?.avatarUrl?'':String(stock?.name||'ST').slice(0,2).toUpperCase();
  el.style.backgroundImage=stock?.avatarUrl?`url("${stock.avatarUrl}")`:'';
}
function stockVerify(stock){return stock?.verified?'<span class="stock-check" title="Проверенная акция">✓</span>':''}
function stockHistoryValue(x){return Math.max(.01,Number(x?.rawPrice ?? x?.price)||.01)}
function closeStockPages(){$('#stockMarketPage')?.classList.add('hidden');$('#stockWalletPage')?.classList.add('hidden')}
function updateStockWalletSetting(){
  const opened=!!(stockWallet?.opened ?? me?.stockWalletOpened);
  $('#stockWalletStatus') && ($('#stockWalletStatus').textContent=opened?'Открыт':'Не открыт');
  $('#stockWalletStatus')?.classList.toggle('opened',opened);
  $('#openStockWallet') && ($('#openStockWallet').textContent=opened?'Перейти':'Открыть');
}

async function loadStockMarket({silent=false}={}){
  if(!token)return;
  try{
    const d=await api('/api/stocks/market');stockMarket=d.stocks||[];
    if(me){me.strawberries=d.balance;me.stockWalletOpened=!!d.walletOpened;syncMeUI?.()}
    $('#stockMarketBalance') && ($('#stockMarketBalance').textContent=`${stockFmt(d.balance)}🍓`);
    updateStockWalletSetting();renderStockMarket();
    if(selectedStock){const fresh=stockMarket.find(s=>s.id===selectedStock.id);if(fresh){selectedStock=fresh;renderStockDetail()}}
  }catch(e){if(!silent)toast(e.message)}
}
function sortedStocks(){
  const mode=$('#stockSort')?.value||'growth',arr=[...stockMarket];
  if(mode==='price_desc')arr.sort((a,b)=>b.price-a.price);
  else if(mode==='price_asc')arr.sort((a,b)=>a.price-b.price);
  else if(mode==='newest')arr.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  else arr.sort((a,b)=>b.growth1h-a.growth1h || b.volume1h-a.volume1h);
  return arr;
}
function renderStockMarket(){
  const box=$('#stockMarketGrid');if(!box)return;box.innerHTML='';
  const canCreate=!!me?.premium,create=$('#createStockBtn');if(create){create.textContent=canCreate?'＋ Создать акцию':'Создать акцию · Premium';create.classList.toggle('premium-locked',!canCreate)}
  sortedStocks().forEach(stock=>{
    const card=document.createElement('article');card.className='stock-card stock-market-card';
    card.innerHTML=`<button class="stock-card-main" type="button" aria-label="Открыть ${escapeHtml(stock.name)}"><div class="stock-avatar stock-market-avatar"></div><div class="stock-card-copy"><div class="stock-card-title-row"><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span class="stock-growth ${stockGrowthClass(stock.growth1h)}">${stockGrowthText(stock.growth1h)}</span></div><span class="stock-card-maker">@${escapeHtml(stock.creator?.username||'user')}</span><div class="stock-unit-price"><span>1 акция</span><strong>${stockFmt(stock.price)}🍓</strong></div></div></button><button class="primary stock-card-buy" type="button">${stock.mine?'Подробнее':'Купить'}</button>`;
    stockAvatar(card.querySelector('.stock-avatar'),stock);
    card.querySelector('.stock-card-main').onclick=()=>openStockDetail(stock.id);
    card.querySelector('.stock-card-buy').onclick=()=>openStockDetail(stock.id,{focusTrade:!stock.mine});
    box.appendChild(card);
  });
  if(!box.children.length)box.innerHTML='<div class="stock-empty"><div>ST</div><b>Рынок пока пуст</b><span>Первая Premium-акция начнёт с цены 0,01🍓.</span></div>';
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
  const totalValue=holdings.reduce((a,s)=>a+(Number(s.value)||0),0),totalBasis=holdings.reduce((a,s)=>a+(Number(s.basis)||0),0),totalPnl=Math.round((totalValue-totalBasis)*100)/100;
  const pnlClass=totalPnl>0?'up':totalPnl<0?'down':'flat';
  const summary=$('#stockPortfolioSummary');if(summary)summary.innerHTML=`<div><span>Можно получить при продаже</span><b>${stockFmt(totalValue)}🍓</b></div><div><span>Результат после комиссий</span><b class="stock-growth ${pnlClass}">${totalPnl>0?'+':''}${stockFmt(totalPnl)}🍓</b></div><div><span>Доступно</span><b>${stockFmt(stockWallet.balance)}🍓</b></div>`;
  const list=$('#stockPortfolioList');if(list){list.innerHTML='';holdings.forEach(stock=>{const row=document.createElement('button');row.type='button';row.className='stock-list-row';row.innerHTML=`<div class="stock-avatar"></div><div class="stock-list-copy"><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span>${stock.qty} шт. · средняя покупка ${stockFmt(stock.avgPrice||stock.price)}🍓</span></div><div class="stock-list-price"><b>${stockFmt(stock.value)}🍓</b><span class="stock-growth ${stockGrowthClass(stock.pnl)}">${Number(stock.pnl)>0?'+':''}${stockFmt(stock.pnl||0)}🍓 · ${stockGrowthText(stock.pnlPct||0)}</span></div>`;stockAvatar(row.querySelector('.stock-avatar'),stock);row.onclick=()=>openStockDetail(stock.id);list.appendChild(row)});if(!list.children.length)list.innerHTML='<div class="stock-empty compact"><b>Портфель пуст</b><span>Открой рынок и выбери первую акцию.</span><button id="walletGoMarket" class="secondary">Перейти на рынок</button></div>';list.querySelector('#walletGoMarket')?.addEventListener('click',e=>{e.stopPropagation();openStockMarket()})}
  const mine=$('#myCreatedStocks');if(mine){mine.innerHTML='';created.forEach(stock=>{const row=document.createElement('button');row.type='button';row.className='stock-list-row creator-stock-row';row.innerHTML=`<div class="stock-avatar"></div><div class="stock-list-copy"><b>${escapeHtml(stock.name)} ${stockVerify(stock)}</b><span>${stock.circulating} в обороте · ${stock.forecast}</span></div><div class="stock-list-price"><b>${stockFmt(stock.price)}🍓</b><span class="stock-growth ${stockGrowthClass(stock.growth1h)}">${stockGrowthText(stock.growth1h)}</span></div>`;stockAvatar(row.querySelector('.stock-avatar'),stock);row.onclick=()=>openStockDetail(stock.id);mine.appendChild(row)});if(!mine.children.length)mine.innerHTML='<div class="stock-empty compact"><b>Своих акций пока нет</b><span>Premium позволяет выпустить до 3 акций.</span></div>'}
  const activity=$('#stockWalletActivity');if(activity){const rows=stockWallet.recentTrades||[];activity.innerHTML=rows.length?`<div class="wallet-section-head simple"><div><b>Последние операции</b><span>Покупки и продажи в вашем кошельке</span></div></div><div class="wallet-activity-list">${rows.map(t=>`<div class="wallet-activity-row"><span class="trade-kind ${t.type==='buy'?'buy':'sell'}">${t.type==='buy'?'Куплено':'Продано'}</span><div><b>${escapeHtml(t.stock?.name||'Удалённая акция')}</b><small>${Math.abs(Number(t.qty)||0)} шт. · комиссия ${stockFmt(t.fee||0)}🍓</small></div><strong>${t.type==='buy'?'-':'+'}${stockFmt(t.total)}🍓</strong></div>`).join('')}</div>`:''}
  const create=$('#createStockFromWallet');if(create){create.disabled=!me?.premium||created.length>=Number(stockWallet.maxCreated||3);create.title=!me?.premium?'Нужен Chatics Premium':created.length>=Number(stockWallet.maxCreated||3)?'Лимит 3 акции':''}
}
async function openStockWallet({fromSettings=false}={}){
  $('#sideMenu')?.classList.add('hidden');$('#sidebar')?.classList.remove('mobile-open');stockWalletReturnToSettings=fromSettings;
  $('#settingsPage')?.classList.add('hidden');$('#stockMarketPage')?.classList.add('hidden');$('#stockWalletPage')?.classList.remove('hidden');await loadStockWallet();
}
async function activateStockWallet(){try{await api('/api/stocks/wallet/open',{method:'POST'});if(me){me.stockWalletOpened=true;syncMeUI?.()}toast('Кошелёк акций открыт');await loadStockWallet()}catch(e){toast(e.message)}}

function drawStockDetailChart(history=[]){
  const c=$('#stockDetailChart');if(!c)return;const ctx=c.getContext('2d'),rows=(history||[]).slice(-100),w=c.width,h=c.height,p=30;ctx.clearRect(0,0,w,h);
  const line=getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#273149',accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#2f7cff',muted=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#8d96a8';
  ctx.strokeStyle=line;ctx.lineWidth=1;for(let i=0;i<4;i++){const y=p+(h-p*2)*i/3;ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}
  if(!rows.length)return;const vals=rows.map(stockHistoryValue),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(.000001,max-min);ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();rows.forEach((r,i)=>{const v=stockHistoryValue(r),x=p+(w-p*2)*(i/Math.max(1,rows.length-1)),y=h-p-(h-p*2)*((v-min)/span);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle=muted;ctx.font='12px sans-serif';ctx.fillText(`${stockFmt(max)}🍓`,4,p+4);ctx.fillText(`${stockFmt(min)}🍓`,4,h-p+4);
}
async function openStockDetail(id,{focusTrade=false}={}){
  const stock=stockMarket.find(s=>s.id===id)||(stockWallet?.holdings||[]).find(s=>s.id===id)||(stockWallet?.created||[]).find(s=>s.id===id);if(!stock)return;
  selectedStock=stock;stockLiveQuote=null;const input=$('#stockTradeQty');if(input)input.value='1';renderStockDetail();openModal('stockDetailModal');
  if(focusTrade&&!stock.mine)setTimeout(()=>$('#stockTradeQty')?.focus(),120);
}
function currentTradeQty(){const q=Math.trunc(Number($('#stockTradeQty')?.value));return Number.isFinite(q)&&q>0?Math.min(5000,q):1}
function renderStockQuote(data,qty){
  if(!selectedStock)return;stockLiveQuote=data;
  const unit=Math.max(.01,Number(selectedStock.price)||.01),buy=$('#buyStockBtn'),sell=$('#sellStockBtn'),opened=Boolean(me?.stockWalletOpened||stockWallet?.opened);
  $('#stockTradeUnit') && ($('#stockTradeUnit').textContent=`${stockFmt(unit)}🍓`);
  if(data?.buy){$('#stockTradeTotal') && ($('#stockTradeTotal').textContent=`Покупка: ${stockFmt(data.buy.total)}🍓`);if(buy&&opened){buy.textContent=`Купить ${qty} · ${stockFmt(data.buy.total)}🍓`;buy.disabled=false}}
  else if(selectedStock.mine){$('#stockTradeTotal') && ($('#stockTradeTotal').textContent='Свою акцию покупать нельзя');if(buy)buy.disabled=true}
  const owned=Number(data?.owned ?? selectedStock.owned)||0;
  if(data?.sell){$('#stockTradeSellTotal') && ($('#stockTradeSellTotal').textContent=`Продажа ${qty} шт.: ${stockFmt(data.sell.total)}🍓`);if(sell&&opened){sell.textContent=`Продать ${qty} · ${stockFmt(data.sell.total)}🍓`;sell.disabled=false}}
  else{$('#stockTradeSellTotal') && ($('#stockTradeSellTotal').textContent=owned?`Для продажи выберите не больше ${owned} шт.`:'У вас пока нет этой акции');if(sell){sell.textContent='Продать';sell.disabled=true}}
}
function updateStockTradeQuote(){
  const s=selectedStock;if(!s)return;const qty=currentTradeQty(),unit=Math.max(.01,Number(s.price)||.01),rough=Math.round(unit*qty*100)/100,opened=Boolean(me?.stockWalletOpened||stockWallet?.opened),buy=$('#buyStockBtn'),sell=$('#sellStockBtn');
  $('#stockTradeUnit') && ($('#stockTradeUnit').textContent=`${stockFmt(unit)}🍓`);$('#stockTradeTotal') && ($('#stockTradeTotal').textContent=`Покупка: ~${stockFmt(rough)}🍓`);$('#stockTradeSellTotal') && ($('#stockTradeSellTotal').textContent='Считаем точную сумму…');
  if(buy){buy.disabled=!!s.mine;buy.textContent=opened?(s.mine?'Своя акция':'Купить'):'Открыть кошелёк'}if(sell){sell.disabled=!opened||!(s.owned>0);sell.textContent='Продать'}
  clearTimeout(stockQuoteTimer);const id=s.id,seq=++stockQuoteSeq;stockQuoteTimer=setTimeout(async()=>{try{const d=await api(`/api/stocks/${encodeURIComponent(id)}/quote?qty=${qty}`);if(seq!==stockQuoteSeq||selectedStock?.id!==id)return;renderStockQuote(d,qty)}catch(e){if(seq===stockQuoteSeq)$('#stockTradeSellTotal') && ($('#stockTradeSellTotal').textContent=e.message)}},110);
}
function renderStockDetail(){
  const s=selectedStock;if(!s)return;$('#stockDetailName').innerHTML=`${escapeHtml(s.name)} ${stockVerify(s)}`;$('#stockDetailCreator').textContent=`Создатель: @${s.creator?.username||'user'}`;stockAvatar($('#stockDetailAvatar'),s);$('#stockDetailPrice').textContent=`${stockFmt(s.price)}🍓 за 1 шт.`;
  const g=$('#stockDetailGrowth');g.className=`stock-growth ${stockGrowthClass(s.growth1h)}`;g.textContent=`${stockGrowthText(s.growth1h)} за последний час`;$('#stockDetailOwned').textContent=`У вас: ${s.owned||0} шт.`;$('#stockDetailForecast').textContent=`${s.forecast} · покупки ${s.buyVolume1h||0} / продажи ${s.sellVolume1h||0}`;drawStockDetailChart(s.history||[]);
  const owner=!!s.mine;$('#stockOwnerTools')?.classList.toggle('hidden',!owner);$('#stockTradeBox')?.classList.toggle('hidden',owner);updateStockTradeQuote();
}
async function tradeStock(type){
  const s=selectedStock;if(!s)return;const opened=!!(me?.stockWalletOpened||stockWallet?.opened);if(!opened){closeModal('stockDetailModal');return openStockWallet()}
  const qty=currentTradeQty();if(!Number.isFinite(qty)||qty<1)return toast('Укажи количество акций');if(type==='sell'&&qty>(Number(s.owned)||0))return toast(`У вас только ${s.owned||0} акций`);
  const btn=type==='buy'?$('#buyStockBtn'):$('#sellStockBtn');setBusy?.(btn,true,type==='buy'?'Покупаем…':'Продаём…');
  try{
    const d=await api(`/api/stocks/${encodeURIComponent(s.id)}/${type}`,{method:'POST',body:JSON.stringify({qty})});if(me){me.strawberries=d.balance;me.stockWalletOpened=true;syncMeUI?.()}
    selectedStock=d.stock;selectedStock.owned=d.holding;const idx=stockMarket.findIndex(x=>x.id===d.stock.id);if(idx>=0)stockMarket[idx]=d.stock;else stockMarket.unshift(d.stock);
    renderStockDetail();renderStockMarket();$('#stockMarketBalance') && ($('#stockMarketBalance').textContent=`${stockFmt(d.balance)}🍓`);$('#stockWalletBalance') && ($('#stockWalletBalance').textContent=`${stockFmt(d.balance)}🍓`);
    toast(type==='buy'?`Куплено ${qty} · −${stockFmt(d.trade?.total)}🍓`:`Продано ${qty} · +${stockFmt(d.trade?.total)}🍓`);Promise.allSettled([loadStockMarket({silent:true}),loadStockWallet()]).then(()=>{if(selectedStock?.id===d.stock.id)renderStockDetail()});
  }catch(e){toast(e.message)}finally{setBusy?.(btn,false)}
}
function requestCreateStock(){if(!me?.premium){toast('Создание акций входит в Chatics Premium');return openModal('premiumModal')}if(stockWallet?.created?.length>=3)return toast('Можно создать не больше 3 акций');openModal('stockCreateModal')}
async function createStock(e){e.preventDefault();const name=$('#stockCreateName').value.trim(),file=$('#stockCreateAvatar').files[0];if(!file)return toast('Выбери аватарку акции');const fd=new FormData();fd.append('name',name);fd.append('avatar',file);const btn=e.currentTarget.querySelector('button[type="submit"]');setBusy?.(btn,true,'Выпускаем…');try{const d=await api('/api/stocks',{method:'POST',body:fd});if(me){me.stockWalletOpened=true;syncMeUI?.()}e.currentTarget.reset();closeModal('stockCreateModal');toast('Акция вышла на рынок');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()]);if(d.stock)openStockDetail(d.stock.id)}catch(err){toast(err.message)}finally{setBusy?.(btn,false)}}

async function loadAdminStocks(){
  if(!me?.isAdmin)return;try{const d=await api('/api/admin/stocks'),box=$('#adminStocksList');if(!box)return;box.innerHTML='';(d.stocks||[]).forEach(s=>{const row=document.createElement('div');row.className='admin-stock-row';row.innerHTML=`<div class="stock-avatar"></div><div class="admin-stock-copy"><b>${escapeHtml(s.name)} ${stockVerify(s)}</b><span>Создатель: @${escapeHtml(s.creator?.username||'Удалён')} · ${stockFmt(s.price)}🍓 · ${s.circulating} в обороте</span><small>${stockGrowthText(s.growth1h)} за час · покупки ${s.buyVolume1h||0} / продажи ${s.sellVolume1h||0}</small></div><div class="admin-stock-actions"><button class="verify-btn stock-verify">${s.verified?'Снять галочку':'Выдать галочку'}</button><button class="danger-button stock-delete">Удалить</button></div>`;stockAvatar(row.querySelector('.stock-avatar'),s);row.querySelector('.stock-verify').onclick=async()=>{try{await api(`/api/admin/stocks/${encodeURIComponent(s.id)}/verified`,{method:'PATCH',body:JSON.stringify({verified:!s.verified})});await loadAdminStocks();await loadStockMarket({silent:true})}catch(e){toast(e.message)}};row.querySelector('.stock-delete').onclick=async()=>{if(!confirm(`Удалить акцию «${s.name}»? Владельцам будут возвращены клубнички.`))return;try{await api(`/api/admin/stocks/${encodeURIComponent(s.id)}`,{method:'DELETE'});toast('Акция удалена');await loadAdminStocks();await loadStockMarket({silent:true})}catch(e){toast(e.message)}};box.appendChild(row)});if(!box.children.length)box.innerHTML='<div class="empty-state">Акций пока нет</div>'}catch(e){toast(e.message)}
}

// Пользовательские каналы остаются отключены.
currentChannel=null;premiumChannels=[];if(typeof loadPremiumChannels==='function')loadPremiumChannels=async()=>{premiumChannels=[];currentChannel=null};if(typeof renderPremiumChannels==='function')renderPremiumChannels=()=>{};$('#sidebarAddFab') && ($('#sidebarAddFab').onclick=()=>openModal('contactModal'));$('#fabChoiceModal')?.classList.add('hidden');

$('#sideStocks')?.addEventListener('click',openStockMarket);$('#sideWalletQuick')?.addEventListener('click',e=>{e.stopPropagation();$('#sideMenu')?.classList.add('hidden');openStockWallet()});$('#walletOpenMarket')?.addEventListener('click',openStockMarket);$('#closeStockMarket')?.addEventListener('click',()=>$('#stockMarketPage').classList.add('hidden'));$('#stockSort')?.addEventListener('change',renderStockMarket);$('#openWalletFromMarket')?.addEventListener('click',()=>openStockWallet());$('#openStockWallet')?.addEventListener('click',()=>openStockWallet({fromSettings:true}));$('#closeStockWallet')?.addEventListener('click',()=>{const page=$('#stockWalletPage');page?.classList.add('hidden');if(stockWalletReturnToSettings)$('#settingsPage')?.classList.remove('hidden');stockWalletReturnToSettings=false});$('#activateStockWallet')?.addEventListener('click',activateStockWallet);$('#createStockBtn')?.addEventListener('click',requestCreateStock);$('#createStockFromWallet')?.addEventListener('click',requestCreateStock);$('#stockCreateForm')?.addEventListener('submit',createStock);$('#buyStockBtn')?.addEventListener('click',()=>tradeStock('buy'));$('#stockTradeQty')?.addEventListener('input',updateStockTradeQuote);$('#stockTradeQty')?.addEventListener('change',updateStockTradeQuote);$('#sellStockBtn')?.addEventListener('click',()=>tradeStock('sell'));
$('#stockOwnerAvatarInput')?.addEventListener('change',async()=>{const f=$('#stockOwnerAvatarInput').files[0],s=selectedStock;if(!f||!s?.mine)return;const fd=new FormData();fd.append('avatar',f);try{const d=await api(`/api/stocks/${encodeURIComponent(s.id)}/avatar`,{method:'PATCH',body:fd});selectedStock=d.stock;toast('Аватарка акции обновлена');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()]);renderStockDetail()}catch(e){toast(e.message)}});
$('#deleteOwnStockBtn')?.addEventListener('click',async()=>{const s=selectedStock;if(!s?.mine||!confirm(`Удалить акцию «${s.name}»? Владельцам вернутся клубнички.`))return;try{await api(`/api/stocks/${encodeURIComponent(s.id)}`,{method:'DELETE'});closeModal('stockDetailModal');selectedStock=null;toast('Акция удалена');await Promise.all([loadStockMarket({silent:true}),loadStockWallet()])}catch(e){toast(e.message)}});
$$('[data-stock-wallet-tab]').forEach(b=>b.addEventListener('click',()=>{$$('[data-stock-wallet-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#stockPortfolioTab')?.classList.toggle('hidden',b.dataset.stockWalletTab!=='portfolio');$('#stockMineTab')?.classList.toggle('hidden',b.dataset.stockWalletTab!=='mine')}));$('#refreshAdminStocks')?.addEventListener('click',loadAdminStocks);
if(typeof setAdminTab==='function'){const base=setAdminTab;setAdminTab=function(tab){base(tab);$('#adminStocksTab')?.classList.toggle('hidden',tab!=='stocks');if(tab==='stocks')loadAdminStocks()};$$('[data-admin-tab]').forEach(b=>b.onclick=()=>setAdminTab(b.dataset.adminTab))}
if(typeof loadAnalytics==='function'){loadAnalytics=async function(){if(!me?.isAdmin)return;try{const d=await api('/api/admin/analytics');const cards=$('#analyticsCards');cards.innerHTML=[['Сейчас онлайн',d.online],['Пользователей',d.users],['Сообщений',d.messages],['Личных сообщений',d.privateMessages],['Акций',d.stocks],['Сделок акций',d.stockTrades],['Premium',d.premium]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('');drawAnalyticsChart(d.registrations||[])}catch(e){toast(e.message)}};$('#refreshAnalytics') && ($('#refreshAnalytics').onclick=loadAnalytics)}
if(typeof syncMeUI==='function'){const base=syncMeUI;syncMeUI=function(){base();updateStockWalletSetting();if($('#stockMarketBalance')&&!$('#stockMarketPage')?.classList.contains('hidden'))$('#stockMarketBalance').textContent=`${stockFmt(me?.strawberries)}🍓`}}
function attachStockSocket(){if(!socket||socket.__stocksV21)return;socket.__stocksV21=true;socket.on('stocks-updated',()=>{loadStockMarket({silent:true});if(!$('#stockWalletPage')?.classList.contains('hidden'))loadStockWallet()});socket.on('balances-updated',async()=>{try{const d=await api('/api/me');me=d.user;syncMeUI()}catch{}})}
if(typeof connect==='function'){const base=connect;connect=function(){base();attachStockSocket()}}
async function stockBoot(){if(!token||!me)return;updateStockWalletSetting();attachStockSocket();await loadStockMarket({silent:true})}
if(typeof startApp==='function'){const base=startApp;startApp=async function(){await base();await stockBoot()}}
setTimeout(stockBoot,1200);

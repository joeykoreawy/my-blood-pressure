'use strict';

const SUPABASE_URL='https://upzgzwngihgoxubzyxbw.supabase.co';
const SUPABASE_KEY='sb_publishable_wYVGWZ5em0F1LmTKBGsbsw_XZoJfbcJ';
const DB_NAME='myBloodPressureDB', DB_VERSION=2, STORE='readings', META='meta', OPS='ops';
const SESSION_KEY='mypressure_session_v1';

const TAG_GROUPS=[
  {label:'시간대', tags:['기상직후','아침','오전','점심','오후','저녁']},
  {label:'식사', tags:['식전','식후']},
  {label:'복약', tags:['약복용전','약복용후']},
  {label:'활동', tags:['활동후','운동후']}
];
const DEFAULT_ROUTINE=[
  {id:'morning_pre_med',label:'아침 · 약 복용 전',tags:['기상직후','아침','약복용전']},
  {id:'morning_post_med',label:'오전 · 약 복용 후',tags:['오전','약복용후']},
  {id:'afternoon_post_med',label:'오후 · 약 복용 후',tags:['오후','약복용후']}
];

let db=null, session=null, allReadings=[], statsDays='7', selectedStatTags=new Set(), quickTags=new Set(), editTags=new Set();
let calDate=new Date(), selectedDateKey=localDateKey(new Date());
let appSettings={medication_started_on:'',timezone:'Asia/Seoul',daily_plan:DEFAULT_ROUTINE};
let authMode='login', syncBusy=false;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function pad(n){return String(n).padStart(2,'0')}
function localDateKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function fmtDate(d){return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short'}).format(d)}
function fmtTime(d){return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}
function avg(a){return a.length?Math.round(a.reduce((s,v)=>s+v,0)/a.length):null}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2100)}
function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||'')}
function newId(){if(crypto.randomUUID)return crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}
function normalizeTag(v){return String(v||'').trim().replace(/^#+/,'').replace(/\s+/g,'').slice(0,20)}
function uniqueTags(tags){return [...new Set((tags||[]).map(normalizeTag).filter(Boolean))]}
function safeJson(v,fallback){try{return JSON.parse(v)}catch{return fallback}}
function isoFromMs(ms){return new Date(ms).toISOString()}
function nowIso(){return new Date().toISOString()}
function isOnline(){return navigator.onLine}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE)){
        const st=d.createObjectStore(STORE,{keyPath:'id'});st.createIndex('timestamp','timestamp');
      }
      if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'});
      if(!d.objectStoreNames.contains(OPS))d.createObjectStore(OPS,{keyPath:'id'});
    };
    req.onsuccess=e=>{db=e.target.result;resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}
function txStore(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function dbGetAll(store=STORE){return new Promise((resolve,reject)=>{const r=txStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
function dbGet(store,key){return new Promise((resolve,reject)=>{const r=txStore(store).get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
function dbPut(v,store=STORE){return new Promise((resolve,reject)=>{const r=txStore(store,'readwrite').put(v);r.onsuccess=()=>resolve(v);r.onerror=()=>reject(r.error)})}
function dbDelete(id,store=STORE){return new Promise((resolve,reject)=>{const r=txStore(store,'readwrite').delete(id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
function dbClear(store=STORE){return new Promise((resolve,reject)=>{const r=txStore(store,'readwrite').clear();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}

async function loadLocalSettings(){
  const row=await dbGet(META,'settings');
  if(row?.value) appSettings={...appSettings,...row.value};
}
async function saveLocalSettings(){await dbPut({key:'settings',value:appSettings},META)}

function getStoredSession(){
  const s=safeJson(localStorage.getItem(SESSION_KEY),null);
  if(!s?.access_token||!s?.refresh_token)return null;
  return s;
}
function storeSession(s){session=s;localStorage.setItem(SESSION_KEY,JSON.stringify(s));renderAccount()}
function clearSession(){session=null;localStorage.removeItem(SESSION_KEY);renderAccount()}

async function apiFetch(path,{method='GET',body=null,token=null,headers={}}={}){
  const h={'apikey':SUPABASE_KEY,...headers};
  if(body!==null)h['Content-Type']='application/json';
  if(token)h['Authorization']=`Bearer ${token}`;
  const res=await fetch(`${SUPABASE_URL}${path}`,{method,headers:h,body:body===null?undefined:JSON.stringify(body)});
  const text=await res.text();
  const data=text?safeJson(text,text):null;
  if(!res.ok){const msg=(data&&typeof data==='object'&&(data.msg||data.message||data.error_description||data.error))||`HTTP ${res.status}`;const err=new Error(msg);err.status=res.status;err.data=data;throw err}
  return data;
}
async function fetchUser(accessToken){return apiFetch('/auth/v1/user',{token:accessToken})}
async function refreshSessionIfNeeded(force=false){
  if(!session)return null;
  const expiresAt=session.expires_at||0;
  if(!force && expiresAt>Date.now()/1000+90)return session;
  try{
    const data=await apiFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
    data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);
    if(!data.user) data.user=await fetchUser(data.access_token);
    storeSession(data);return data;
  }catch(e){console.warn('session refresh failed',e);clearSession();return null}
}
async function ensureSession(){return refreshSessionIfNeeded(false)}

async function signIn(email,password){
  const data=await apiFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);
  storeSession(data);return data;
}
async function signUp(email,password){
  const redirectTo=location.origin+location.pathname;
  const data=await apiFetch(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,{method:'POST',body:{email,password}});
  if(data?.access_token){data.expires_at=Math.floor(Date.now()/1000)+(data.expires_in||3600);storeSession(data)}
  return data;
}
async function signOut(){
  try{if(session?.access_token)await apiFetch('/auth/v1/logout',{method:'POST',token:session.access_token})}catch{}
  clearSession();await refresh();toast('로그아웃했습니다. 로컬 기록은 이 기기에 남아 있습니다.');
}
async function consumeAuthRedirect(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const error=hash.get('error_description')||new URLSearchParams(location.search).get('error_description');
  if(error){setNotice(decodeURIComponent(error),'error');history.replaceState({},'',location.pathname);return}
  const access=hash.get('access_token'),refresh=hash.get('refresh_token');
  if(access&&refresh){
    try{
      const user=await fetchUser(access);const expiresIn=Number(hash.get('expires_in')||3600);
      storeSession({access_token:access,refresh_token:refresh,expires_in:expiresIn,expires_at:Math.floor(Date.now()/1000)+expiresIn,user});
      history.replaceState({},'',location.pathname);setNotice('이메일 인증이 완료되었습니다. 서버 동기화를 준비했습니다.','success');
    }catch(e){console.warn(e)}
  }
}

function setNotice(msg,type=''){
  const n=$('#connectionNotice');if(!msg){n.className='notice hidden';n.textContent='';return}n.className=`notice ${type}`;n.textContent=msg;
}
function currentOwnerId(){return session?.user?.id||null}
function visibleReadings(rows){
  const uid=currentOwnerId();
  if(uid)return rows.filter(r=>r.ownerId===uid || !r.ownerId);
  return rows.filter(r=>!r.ownerId);
}
async function refresh(){
  const rows=await dbGetAll(STORE);
  allReadings=visibleReadings(rows).map(normalizeLocalRecord).sort((a,b)=>b.timestamp-a.timestamp);
  renderAll();
}
function normalizeLocalRecord(r){
  return {...r,tags:uniqueTags(r.tags||[]),note:r.note||'',pulse:r.pulse||null,syncStatus:r.syncStatus||(!r.ownerId?'local':'synced')};
}

function localToServer(r){
  return {id:r.id,user_id:currentOwnerId(),measured_at:isoFromMs(r.timestamp),systolic:r.sys,diastolic:r.dia,pulse:r.pulse||null,tags:uniqueTags(r.tags),note:r.note||'',created_at:r.createdAt?isoFromMs(r.createdAt):isoFromMs(r.timestamp),updated_at:r.updatedAt?isoFromMs(r.updatedAt):nowIso()};
}
function serverToLocal(r){
  return {id:r.id,ownerId:r.user_id,timestamp:new Date(r.measured_at).getTime(),sys:r.systolic,dia:r.diastolic,pulse:r.pulse||null,tags:uniqueTags(r.tags||[]),note:r.note||'',createdAt:new Date(r.created_at||r.measured_at).getTime(),updatedAt:new Date(r.updated_at||r.created_at||r.measured_at).getTime(),syncStatus:'synced'};
}

async function rest(path,{method='GET',body=null,prefer=''}={}){
  const s=await ensureSession();if(!s)throw new Error('로그인이 필요합니다.');
  const headers={};if(prefer)headers['Prefer']=prefer;
  return apiFetch(`/rest/v1/${path}`,{method,body,token:s.access_token,headers});
}
async function fetchServerReadings(){return rest('bp_measurements?select=*&order=measured_at.desc')}
async function upsertServerReading(r){return rest('bp_measurements?on_conflict=id',{method:'POST',body:localToServer(r),prefer:'resolution=merge-duplicates,return=representation'})}
async function deleteServerReading(id){return rest(`bp_measurements?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',prefer:'return=minimal'})}
async function fetchServerSettings(){
  const uid=currentOwnerId();if(!uid)return null;
  const rows=await rest(`user_settings?select=*&user_id=eq.${encodeURIComponent(uid)}`);return Array.isArray(rows)?rows[0]||null:null;
}
async function upsertServerSettings(){
  const uid=currentOwnerId();if(!uid)return;
  const payload={user_id:uid,medication_started_on:appSettings.medication_started_on||null,timezone:'Asia/Seoul',daily_plan:appSettings.daily_plan||DEFAULT_ROUTINE,updated_at:nowIso()};
  await rest('user_settings?on_conflict=user_id',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=minimal'});
}

async function adoptLegacyLocalRows(){
  const uid=currentOwnerId();if(!uid)return;
  const rows=await dbGetAll(STORE);const legacy=rows.filter(r=>!r.ownerId);
  if(!legacy.length)return;
  const adoptedFlag=await dbGet(META,`legacyAdopted:${uid}`);if(adoptedFlag)return;
  const ok=confirm(`기존 V1에서 저장된 로컬 기록 ${legacy.length}건을 현재 계정으로 가져와 서버에 백업할까요?\n\n'확인'을 누르면 이 계정의 기록으로 연결합니다.`);
  if(!ok){await dbPut({key:`legacyAdopted:${uid}`,value:'skipped'},META);return}
  for(const old of legacy){
    const id=isUuid(old.id)?old.id:newId();
    const upgraded={...old,id,ownerId:uid,tags:uniqueTags(old.tags||[]),syncStatus:'pending',updatedAt:old.updatedAt||Date.now()};
    if(id!==old.id)await dbDelete(old.id,STORE);
    await dbPut(upgraded,STORE);
  }
  await dbPut({key:`legacyAdopted:${uid}`,value:'done'},META);
}

async function processPendingDeletes(){
  const uid=currentOwnerId();if(!uid)return;
  const ops=await dbGetAll(OPS);
  for(const op of ops.filter(o=>o.ownerId===uid&&o.type==='delete')){
    try{await deleteServerReading(op.recordId);await dbDelete(op.id,OPS)}catch(e){if(e.status===401)throw e;console.warn('delete sync failed',e)}
  }
}
async function syncNow({quiet=false}={}){
  if(syncBusy)return; if(!session){if(!quiet)toast('로그인하면 서버 동기화를 사용할 수 있습니다.');return} if(!isOnline()){setSyncState('offline');if(!quiet)toast('오프라인입니다. 로컬에 먼저 저장합니다.');return}
  syncBusy=true;setSyncState('syncing');
  try{
    await ensureSession();if(!session)throw new Error('로그인 세션이 만료되었습니다.');
    await adoptLegacyLocalRows();
    await processPendingDeletes();
    const uid=currentOwnerId();
    let rows=await dbGetAll(STORE);
    const mine=rows.filter(r=>r.ownerId===uid);
    for(const r0 of mine){
      const r=normalizeLocalRecord(r0);
      if(r.syncStatus==='pending'||r.syncStatus==='local'){
        if(!isUuid(r.id)){
          const oldId=r.id;r.id=newId();await dbDelete(oldId,STORE);await dbPut(r,STORE);
        }
        await upsertServerReading(r);r.syncStatus='synced';await dbPut(r,STORE);
      }
    }
    const remote=await fetchServerReadings();
    rows=await dbGetAll(STORE);const byId=new Map(rows.map(r=>[r.id,r]));
    for(const sr of remote||[]){
      const incoming=serverToLocal(sr),local=byId.get(incoming.id);
      if(!local || (incoming.updatedAt||0)>=(local.updatedAt||0) || local.syncStatus!=='pending')await dbPut(incoming,STORE);
    }
    const serverSettings=await fetchServerSettings();
    if(serverSettings){
      appSettings={...appSettings,medication_started_on:serverSettings.medication_started_on||'',timezone:serverSettings.timezone||'Asia/Seoul',daily_plan:Array.isArray(serverSettings.daily_plan)?serverSettings.daily_plan:DEFAULT_ROUTINE};await saveLocalSettings();
    }else await upsertServerSettings();
    await refresh();setSyncState('online');if(!quiet)toast('서버 동기화를 완료했습니다.');
  }catch(e){console.error(e);setSyncState('error');if(!quiet)toast(`동기화 실패: ${e.message}`)}finally{syncBusy=false;renderAccount()}
}

function setSyncState(state){
  const pill=$('#syncPill'),txt=pill.querySelector('span');pill.className='sync-pill';
  if(state==='online'){pill.classList.add('online');txt.textContent='서버 동기화됨'}
  else if(state==='syncing'){pill.classList.add('warn');txt.textContent='동기화 중…'}
  else if(state==='error'){pill.classList.add('error');txt.textContent='동기화 오류'}
  else if(state==='offline'){pill.classList.add('warn');txt.textContent='오프라인 · 로컬 저장'}
  else{pill.classList.add('warn');txt.textContent=session?'동기화 대기':'로컬 저장'}
}

function renderAll(){renderHome();renderStats();renderCalendar();renderAccount();renderSettings()}
function renderHome(){
  const todayKey=localDateKey(new Date());const today=allReadings.filter(r=>localDateKey(new Date(r.timestamp))===todayKey);
  [['#todaySys',avg(today.map(r=>r.sys))],['#todayDia',avg(today.map(r=>r.dia))],['#todayPulse',avg(today.filter(r=>r.pulse).map(r=>r.pulse))]].forEach(([id,v])=>{const e=$(id);e.textContent=v??'—';e.classList.toggle('empty',v==null)});
  const now=Date.now(),d7=7*864e5,cur=allReadings.filter(r=>r.timestamp>=now-d7),prev=allReadings.filter(r=>r.timestamp<now-d7&&r.timestamp>=now-2*d7);
  if(cur.length&&prev.length){const ds=avg(cur.map(r=>r.sys))-avg(prev.map(r=>r.sys)),dd=avg(cur.map(r=>r.dia))-avg(prev.map(r=>r.dia));$('#weekTrend').innerHTML=`이전 7일 대비 최고 <b class="${ds>0?'up':ds<0?'down':'flat'}">${ds>0?'+':''}${ds}</b>, 최저 <b class="${dd>0?'up':dd<0?'down':'flat'}">${dd>0?'+':''}${dd} mmHg</b>`}else $('#weekTrend').textContent=today.length?`오늘 ${today.length}회 측정했습니다.`:'최근 기록을 쌓으면 7일 평균 변화가 표시됩니다.';
  const recent=allReadings.slice(0,6);$('#recentLabel').textContent=allReadings.length?`총 ${allReadings.length}건`:'';$('#recentList').innerHTML=recent.length?recent.map(entryHtml).join(''):'<div class="empty-state">아직 기록이 없습니다.<br>첫 혈압을 입력해보세요.</div>';
  renderRoutine(today);
}
function routineMatch(r,item){const tags=new Set(r.tags||[]);return item.tags.every(t=>tags.has(t))}
function renderRoutine(today){
  const plan=Array.isArray(appSettings.daily_plan)?appSettings.daily_plan:DEFAULT_ROUTINE;let done=0;
  $('#routineList').innerHTML=plan.map(item=>{const hit=today.find(r=>routineMatch(r,item));if(hit)done++;return `<div class="routine-item ${hit?'done':''}"><div class="routine-left"><div class="check">${hit?'✓':'○'}</div><div><div class="routine-label">${escapeHtml(item.label)}</div><div class="routine-sub">${item.tags.map(t=>'#'+escapeHtml(t)).join(' ')}</div></div></div>${hit?`<div class="routine-sub">${fmtTime(new Date(hit.timestamp))}</div>`:`<button class="routine-action" onclick="presetRoutine('${item.id}')">기록</button>`}</div>`}).join('');
  $('#routineCount').textContent=`${done} / ${plan.length}`;
}
window.presetRoutine=function(id){const item=(appSettings.daily_plan||DEFAULT_ROUTINE).find(x=>x.id===id);if(!item)return;quickTags=new Set(item.tags);renderQuickTagGroups();$('#sys').focus();window.scrollTo({top:$('#quickForm').getBoundingClientRect().top+window.scrollY-85,behavior:'smooth'})}

function entryHtml(r){
  const d=new Date(r.timestamp);const tags=(r.tags||[]).map(t=>`<span class="mini-tag">#${escapeHtml(t)}</span>`).join('');
  const note=r.note?` · ${escapeHtml(r.note)}`:'';const pending=r.syncStatus==='pending';
  return `<div class="entry"><div><div class="bp">${r.sys} / ${r.dia}</div><div class="sub">${fmtDate(d)} · ${fmtTime(d)}${note}</div>${tags?`<div class="entry-tags">${tags}</div>`:''}${pending?'<div class="sync-mark pending">서버 동기화 대기</div>':''}</div><div class="right"><div class="pulse">${r.pulse?`♥ ${r.pulse}`:'맥박 —'}</div><button class="menu" onclick="openEdit('${r.id}')">•••</button></div></div>`;
}

function allKnownTags(){
  const base=TAG_GROUPS.flatMap(g=>g.tags),fromRows=allReadings.flatMap(r=>r.tags||[]);return [...new Set([...base,...fromRows])];
}
function tagGroupHtml(selectedSet,mode){
  return TAG_GROUPS.map(g=>`<div style="margin-bottom:8px"><div class="tag-section-title"><span style="font-weight:750;color:var(--muted)">${g.label}</span></div><div class="tags">${g.tags.map(t=>`<button type="button" class="tag-chip ${selectedSet.has(t)?'selected':''}" data-tag="${escapeHtml(t)}" data-mode="${mode}">#${escapeHtml(t)}</button>`).join('')}</div></div>`).join('');
}
function renderQuickTagGroups(){
  $('#quickTagGroups').innerHTML=tagGroupHtml(quickTags,'quick');
  $$('#quickTagGroups .tag-chip').forEach(b=>b.onclick=()=>{const t=b.dataset.tag;quickTags.has(t)?quickTags.delete(t):quickTags.add(t);renderQuickTagGroups()});
  const base=new Set(TAG_GROUPS.flatMap(g=>g.tags));const custom=[...quickTags].filter(t=>!base.has(t));
  $('#selectedCustomTags').innerHTML=custom.map(t=>`<button type="button" class="tag-chip selected" data-custom="${escapeHtml(t)}">#${escapeHtml(t)} <span class="x">×</span></button>`).join('');
  $$('#selectedCustomTags [data-custom]').forEach(b=>b.onclick=()=>{quickTags.delete(b.dataset.custom);renderQuickTagGroups()});
}
function renderEditTagGroups(){
  const custom=[...editTags].filter(t=>!TAG_GROUPS.flatMap(g=>g.tags).includes(t));
  $('#editTagGroups').innerHTML=tagGroupHtml(editTags,'edit')+(custom.length?`<div class="tags" style="margin-top:7px">${custom.map(t=>`<button type="button" class="tag-chip selected" data-edit-custom="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}</div>`:'');
  $$('#editTagGroups [data-mode="edit"]').forEach(b=>b.onclick=()=>{const t=b.dataset.tag;editTags.has(t)?editTags.delete(t):editTags.add(t);renderEditTagGroups()});
  $$('#editTagGroups [data-edit-custom]').forEach(b=>b.onclick=()=>{editTags.delete(b.dataset.editCustom);renderEditTagGroups()});
}

function periodBaseRows(){
  const days=statsDays;
  if(days==='0')return [...allReadings].reverse();
  if(days==='med'){
    if(!appSettings.medication_started_on)return [];
    const cutoff=new Date(appSettings.medication_started_on+'T00:00:00').getTime();return allReadings.filter(r=>r.timestamp>=cutoff).reverse();
  }
  const cutoff=Date.now()-Number(days)*864e5;return allReadings.filter(r=>r.timestamp>=cutoff).reverse();
}
function getFiltered(){
  let rows=periodBaseRows();if(selectedStatTags.size)rows=rows.filter(r=>{const tags=new Set(r.tags||[]);return [...selectedStatTags].every(t=>tags.has(t))});return rows;
}
function renderStatTagFilters(){
  const tags=allKnownTags();$('#statTagFilters').innerHTML=tags.map(t=>`<button type="button" class="tag-chip ${selectedStatTags.has(t)?'filter-selected':''}" data-filter-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('');
  $$('#statTagFilters [data-filter-tag]').forEach(b=>b.onclick=()=>{const t=b.dataset.filterTag;selectedStatTags.has(t)?selectedStatTags.delete(t):selectedStatTags.add(t);renderStats()});
}
function renderStats(){
  renderStatTagFilters();const rows=getFiltered();
  let periodText=statsDays==='0'?'전체 기록':statsDays==='med'?(appSettings.medication_started_on?`${appSettings.medication_started_on} 이후`:'복약 시작일 미설정'):`최근 ${statsDays}일`;
  if(selectedStatTags.size)periodText+=` · ${[...selectedStatTags].map(t=>'#'+t).join(' + ')}`;$('#statPeriodText').textContent=periodText;
  const sys=rows.map(r=>r.sys),dia=rows.map(r=>r.dia),pul=rows.filter(r=>r.pulse).map(r=>r.pulse);$('#avgSys').textContent=avg(sys)??'—';$('#avgDia').textContent=avg(dia)??'—';$('#avgPulse').textContent=avg(pul)??'—';$('#minSys').textContent=sys.length?Math.min(...sys):'—';$('#maxSys').textContent=sys.length?Math.max(...sys):'—';$('#countStat').textContent=rows.length;drawChart(rows);
  const box=$('#periodChange');if(rows.length<2){box.className='empty-state';box.textContent='기록이 2개 이상 쌓이면 변화폭을 계산합니다.'}else{const mid=Math.floor(rows.length/2),a=rows.slice(0,mid),b=rows.slice(mid),ds=avg(b.map(r=>r.sys))-avg(a.map(r=>r.sys)),dd=avg(b.map(r=>r.dia))-avg(a.map(r=>r.dia));box.className='';box.innerHTML=`<div class="stats-grid"><div class="stat"><b>${ds>0?'+':''}${ds}</b><span>최고혈압 변화</span></div><div class="stat"><b>${dd>0?'+':''}${dd}</b><span>최저혈압 변화</span></div><div class="stat"><b>${rows.length}</b><span>기간 측정수</span></div></div><div class="footnote">선택된 기록을 시간순으로 절반씩 나눠 앞 절반 평균과 뒤 절반 평균의 차이를 계산했습니다.</div>`}
  renderMedicationCompare(periodBaseRows());
}
function renderMedicationCompare(rows){
  const pre=rows.filter(r=>(r.tags||[]).includes('약복용전')),post=rows.filter(r=>(r.tags||[]).includes('약복용후'));const ps=avg(pre.map(r=>r.sys)),pd=avg(pre.map(r=>r.dia)),qs=avg(post.map(r=>r.sys)),qd=avg(post.map(r=>r.dia));
  $('#preMedBp').textContent=pre.length?`${ps} / ${pd}`:'— / —';$('#postMedBp').textContent=post.length?`${qs} / ${qd}`:'— / —';$('#preMedCount').textContent=pre.length?`${pre.length}회 평균`:'기록 없음';$('#postMedCount').textContent=post.length?`${post.length}회 평균`:'기록 없음';$('#medComparePeriod').textContent=statsDays==='0'?'전체':statsDays==='med'?'복약 이후':`${statsDays}일`;
  if(pre.length&&post.length){const ds=qs-ps,dd=qd-pd;$('#medDiff').innerHTML=`복용 후 태그 평균은 복용 전보다 최고 <b>${ds>0?'+':''}${ds}</b>, 최저 <b>${dd>0?'+':''}${dd} mmHg</b>입니다.`}else $('#medDiff').textContent='전·후 태그가 모두 쌓이면 평균 차이를 표시합니다.';
}
function drawChart(rows){
  const c=$('#trendChart'),rect=c.getBoundingClientRect();if(rect.width<20)return;const dpr=window.devicePixelRatio||1;c.width=Math.max(1,rect.width*dpr);c.height=Math.max(1,rect.height*dpr);const x=c.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;x.clearRect(0,0,w,h);
  if(!rows.length){x.fillStyle='#8a949e';x.font='12px -apple-system';x.textAlign='center';x.fillText(statsDays==='med'&&!appSettings.medication_started_on?'더보기에서 복약 시작일을 설정하세요.':'이 조건의 기록이 없습니다.',w/2,h/2);return}
  const daily={};rows.forEach(r=>{const k=localDateKey(new Date(r.timestamp));(daily[k]??=[]).push(r)});const pts=Object.keys(daily).sort().map(k=>({k,sys:avg(daily[k].map(r=>r.sys)),dia:avg(daily[k].map(r=>r.dia))}));const vals=pts.flatMap(p=>[p.sys,p.dia]);let min=Math.min(...vals)-10,max=Math.max(...vals)+10;min=Math.max(20,Math.floor(min/10)*10);max=Math.ceil(max/10)*10;if(max-min<40){max+=20;min-=20}
  const L=34,R=10,T=12,B=28,iw=w-L-R,ih=h-T-B;x.strokeStyle='#e6eaee';x.lineWidth=1;x.fillStyle='#8a949e';x.font='10px -apple-system';x.textAlign='right';for(let i=0;i<=4;i++){const y=T+ih*i/4,v=Math.round(max-(max-min)*i/4);x.beginPath();x.moveTo(L,y);x.lineTo(w-R,y);x.stroke();x.fillText(v,L-5,y+3)}
  const px=i=>pts.length===1?L+iw/2:L+iw*i/(pts.length-1),py=v=>T+ih*(max-v)/(max-min);function line(key,color){x.strokeStyle=color;x.lineWidth=2.5;x.lineJoin='round';x.lineCap='round';x.beginPath();pts.forEach((p,i)=>{const X=px(i),Y=py(p[key]);i?x.lineTo(X,Y):x.moveTo(X,Y)});x.stroke();pts.forEach((p,i)=>{x.fillStyle=color;x.beginPath();x.arc(px(i),py(p[key]),3,0,Math.PI*2);x.fill()})}line('sys','#2563eb');line('dia','#0f766e');
  x.fillStyle='#8a949e';x.textAlign='center';const idx=pts.length<=4?pts.map((_,i)=>i):[0,Math.floor((pts.length-1)/2),pts.length-1];idx.forEach(i=>{const [,m,d]=pts[i].k.split('-');x.fillText(`${m}.${d}`,px(i),h-8)});
}

function renderCalendar(){
  const y=calDate.getFullYear(),m=calDate.getMonth();$('#calendarTitle').textContent=`${y}년 ${m+1}월`;const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());const has=new Set(allReadings.map(r=>localDateKey(new Date(r.timestamp))));let html='';
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const k=localDateKey(d);html+=`<button class="day ${d.getMonth()!==m?'other':''} ${k===localDateKey(new Date())?'today':''} ${k===selectedDateKey?'selected':''} ${has.has(k)?'has':''}" data-date="${k}">${d.getDate()}</button>`}$('#calendarGrid').innerHTML=html;
  $$('#calendarGrid .day').forEach(b=>b.onclick=()=>{selectedDateKey=b.dataset.date;renderCalendar()});const chosen=allReadings.filter(r=>localDateKey(new Date(r.timestamp))===selectedDateKey);const d=new Date(selectedDateKey+'T12:00:00');$('#selectedDateTitle').textContent=fmtDate(d);$('#selectedSummary').textContent=chosen.length?`${chosen.length}회 · 평균 ${avg(chosen.map(r=>r.sys))}/${avg(chosen.map(r=>r.dia))}`:'기록 없음';$('#dayList').innerHTML=chosen.length?chosen.map(entryHtml).join(''):'<div class="empty-state">이 날짜의 기록이 없습니다.</div>';
}

function renderAccount(){
  const logged=!!session?.user?.id;$('#loggedOutBox').classList.toggle('hidden',logged);$('#loggedInBox').classList.toggle('hidden',!logged);$('#accountState').textContent=logged?'서버 연결됨':'로그인 안 됨';
  if(logged){$('#accountEmail').textContent=session.user.email||'로그인됨';const pending=allReadings.filter(r=>r.syncStatus==='pending').length;$('#syncMeta').textContent=isOnline()?(pending?`${pending}건 동기화 대기`:'로컬·서버 동기화 사용 중'):'현재 오프라인';setSyncState(isOnline()?(pending?'idle':'online'):'offline')}else setSyncState('local');
}
function renderSettings(){$('#medStartDate').value=appSettings.medication_started_on||''}

window.openEdit=function(id){const r=allReadings.find(v=>v.id===id);if(!r)return;$('#editId').value=id;$('#editSys').value=r.sys;$('#editDia').value=r.dia;$('#editPulse').value=r.pulse||'';$('#editNote').value=r.note||'';editTags=new Set(r.tags||[]);renderEditTagGroups();const d=new Date(r.timestamp),local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);$('#editDate').value=local;$('#editDialog').showModal()}

async function saveReadingLocal(r){await dbPut(r,STORE);await refresh();if(session&&isOnline())syncNow({quiet:true})}
async function deleteReading(r){
  if(!confirm('이 기록을 삭제할까요?'))return;await dbDelete(r.id,STORE);
  if(r.ownerId&&session?.user?.id===r.ownerId){await dbPut({id:`delete:${r.id}`,type:'delete',recordId:r.id,ownerId:r.ownerId,createdAt:Date.now()},OPS);if(isOnline())syncNow({quiet:true})}
  await refresh();toast('삭제했습니다.');
}

$('#quickForm').addEventListener('submit',async e=>{
  e.preventDefault();const sys=+$('#sys').value,dia=+$('#dia').value,pulse=$('#pulse').value?+$('#pulse').value:null;if(sys<=dia)return toast('최고 혈압이 최저 혈압보다 커야 합니다.');
  const r={id:newId(),ownerId:currentOwnerId(),timestamp:Date.now(),sys,dia,pulse,tags:uniqueTags([...quickTags]),note:$('#note').value.trim(),createdAt:Date.now(),updatedAt:Date.now(),syncStatus:session?'pending':'local'};
  await saveReadingLocal(r);e.target.reset();quickTags.clear();renderQuickTagGroups();toast(session?'혈압을 기록했습니다. 서버 동기화를 준비합니다.':'혈압을 로컬에 기록했습니다.');
});
$('#addCustomTag').onclick=()=>{const t=normalizeTag($('#customTag').value);if(!t)return;quickTags.add(t);$('#customTag').value='';renderQuickTagGroups()};
$('#customTag').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addCustomTag').click()}});

$('#editForm').addEventListener('submit',async e=>{
  e.preventDefault();const old=allReadings.find(r=>r.id===$('#editId').value);if(!old)return;const sys=+$('#editSys').value,dia=+$('#editDia').value;if(sys<=dia)return toast('최고 혈압이 최저 혈압보다 커야 합니다.');
  const r={...old,sys,dia,pulse:$('#editPulse').value?+$('#editPulse').value:null,tags:uniqueTags([...editTags]),note:$('#editNote').value.trim(),timestamp:new Date($('#editDate').value).getTime(),updatedAt:Date.now(),syncStatus:session?'pending':old.syncStatus};await saveReadingLocal(r);$('#editDialog').close();toast('수정했습니다.');
});
$('#editCancel').onclick=()=>$('#editDialog').close();$('#editDelete').onclick=async()=>{const r=allReadings.find(x=>x.id===$('#editId').value);if(!r)return;$('#editDialog').close();await deleteReading(r)};

$$('nav button').forEach(b=>b.onclick=()=>{$$('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.remove('active'));$('#view-'+b.dataset.view).classList.add('active');if(b.dataset.view==='stats')setTimeout(()=>renderStats(),30)});
$$('#periodSeg button').forEach(b=>b.onclick=()=>{$$('#periodSeg button').forEach(x=>x.classList.remove('active'));b.classList.add('active');statsDays=b.dataset.days;renderStats()});
$('#clearTagFilter').onclick=()=>{selectedStatTags.clear();renderStats()};
$('#prevMonth').onclick=()=>{calDate=new Date(calDate.getFullYear(),calDate.getMonth()-1,1);renderCalendar()};$('#nextMonth').onclick=()=>{calDate=new Date(calDate.getFullYear(),calDate.getMonth()+1,1);renderCalendar()};

function openAuth(){authMode='login';renderAuthMode();$('#authDialog').showModal()}
function renderAuthMode(){$('#loginTab').classList.toggle('active',authMode==='login');$('#signupTab').classList.toggle('active',authMode==='signup');$('#authSubmit').textContent=authMode==='login'?'로그인':'회원가입';$('#authPassword').autocomplete=authMode==='login'?'current-password':'new-password';$('#authMsg').textContent=authMode==='login'?'':'가입 후 이메일 인증을 요청할 수 있습니다.';$('#authMsg').className='auth-msg'}
$('#openAuth').onclick=openAuth;$('#loginTab').onclick=()=>{authMode='login';renderAuthMode()};$('#signupTab').onclick=()=>{authMode='signup';renderAuthMode()};$('#authCancel').onclick=()=>$('#authDialog').close();
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();const email=$('#authEmail').value.trim(),password=$('#authPassword').value;$('#authSubmit').disabled=true;$('#authMsg').className='auth-msg';$('#authMsg').textContent=authMode==='login'?'로그인 중…':'계정 생성 중…';
  try{
    if(authMode==='login'){await signIn(email,password);$('#authDialog').close();await syncNow();}
    else{const data=await signUp(email,password);if(data?.access_token){$('#authDialog').close();await syncNow();toast('회원가입과 로그인이 완료되었습니다.')}else{$('#authMsg').textContent='가입 요청이 완료되었습니다. 이메일 인증 후 이 화면에서 로그인하세요.'}}
  }catch(err){$('#authMsg').className='auth-msg error';$('#authMsg').textContent=err.message||'처리하지 못했습니다.'}finally{$('#authSubmit').disabled=false}
});
$('#logoutBtn').onclick=signOut;$('#syncNow').onclick=()=>syncNow();

$('#medStartDate').onchange=async e=>{appSettings.medication_started_on=e.target.value||'';await saveLocalSettings();renderStats();if(session&&isOnline()){try{await upsertServerSettings();toast('복약 시작일을 저장했습니다.')}catch(err){toast('로컬에는 저장했지만 서버 설정 저장에 실패했습니다.')}}else toast('복약 시작일을 저장했습니다.')};

function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},600)}
$('#exportJson').onclick=()=>download(`mypressure_백업_${localDateKey(new Date())}.json`,JSON.stringify({app:'mypressure',version:'1.0',exportedAt:new Date().toISOString(),settings:appSettings,readings:allReadings.map(({ownerId,syncStatus,...r})=>r)},null,2),'application/json');
$('#exportCsv').onclick=()=>{const head=['날짜','시간','최고혈압','최저혈압','맥박','태그','메모'];const rows=[head,...[...allReadings].reverse().map(r=>{const d=new Date(r.timestamp);return [localDateKey(d),fmtTime(d),r.sys,r.dia,r.pulse||'',(r.tags||[]).map(t=>'#'+t).join(' '),r.note||'']})];const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');download(`mypressure_${localDateKey(new Date())}.csv`,csv,'text/csv;charset=utf-8')};
$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!Array.isArray(obj.readings))throw new Error('readings 없음');if(!confirm(`${obj.readings.length}건의 기록을 현재 데이터에 합칠까요?`))return;for(const src of obj.readings){if(!src.timestamp||!src.sys||!src.dia)continue;const id=isUuid(src.id)?src.id:newId();await dbPut({...src,id,ownerId:currentOwnerId(),tags:uniqueTags(src.tags||[]),note:src.note||'',createdAt:src.createdAt||src.timestamp,updatedAt:Date.now(),syncStatus:session?'pending':'local'},STORE)}if(obj.settings){appSettings={...appSettings,...obj.settings};await saveLocalSettings()}await refresh();if(session&&isOnline())syncNow({quiet:true});toast('백업을 복원했습니다.')}catch{alert('올바른 MyPressure/V1 JSON 백업 파일이 아닙니다.')}e.target.value=''};
$('#deleteLocal').onclick=async()=>{if(!allReadings.length)return toast('삭제할 로컬 기록이 없습니다.');if(!confirm('이 기기에 저장된 현재 계정/로컬 기록을 삭제할까요?\n서버의 기록은 삭제하지 않습니다.'))return;const rows=await dbGetAll(STORE),visibleIds=new Set(allReadings.map(r=>r.id));for(const r of rows)if(visibleIds.has(r.id))await dbDelete(r.id,STORE);await refresh();toast('이 기기의 로컬 기록을 삭제했습니다. 서버 기록은 유지됩니다.')};

window.addEventListener('online',()=>{setSyncState(session?'idle':'local');if(session)syncNow({quiet:true})});window.addEventListener('offline',()=>setSyncState('offline'));window.addEventListener('resize',()=>{if($('#view-stats').classList.contains('active'))drawChart(getFiltered())});

async function init(){
  try{
    $('#headerDate').innerHTML=fmtDate(new Date()).replace('(','<br>(');await openDB();await loadLocalSettings();session=getStoredSession();await consumeAuthRedirect();if(session)await refreshSessionIfNeeded(false);renderQuickTagGroups();await refresh();
    if(session&&isOnline())syncNow({quiet:true});
    if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{})}
    if(!session)setNotice('현재는 로컬 저장 모드입니다. 더보기 → 로그인에서 계정을 연결하면 서버에도 백업됩니다.');else setNotice('','');
  }catch(e){console.error(e);alert('MyPressure를 시작하지 못했습니다. Safari 저장소 설정 또는 네트워크를 확인해주세요.')}
}
init();

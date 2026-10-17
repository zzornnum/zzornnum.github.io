'use strict';

const REPO = 'zzornnum/zzornnum.github.io';
// 생각 탭은 비공개 저장소에 저장: 토큰이 있는 브라우저에서만 읽고 쓴다
const PRIVATE_REPO = 'zzornnum/invest-private';
const TOKEN_KEY = 'gh_token';
const LISTS = { holdings: '보유종목', watchlist: '관심종목' };
// 처분종목은 비공개 저장소(invest-private)에 따로 저장된다
const LIST_NAMES = { ...LISTS, sold: '처분종목' };
const storeOf = (list) => (list === 'sold' ? 'sold' : 'portfolio');

const state = {
  market: null,
  byCode: new Map(),
  portfolio: { holdings: [], watchlist: [] },
  thoughts: { folders: [], posts: [] },
  sold: { sold: [] },
  trash: { items: [] },
  sha: {},
  access: {},
  newsIndex: [],
  newsCache: {},
  newsDate: null,
  topMarket: 'KOSPI',
  newsTab: 'holdings',
  reorder: null,
  open: new Set(),
};

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const dialog = $('#dialog');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- token (owner only, stays in this browser) ---------- */
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
const canEdit = () => !!getToken();

/* ---------- formatting ---------- */
const fmtNum = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
function fmtCap(eok) {
  if (eok == null) return '-';
  if (eok >= 10000) {
    const jo = Math.floor(eok / 10000), rest = eok % 10000;
    return rest ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${jo.toLocaleString()}조`;
  }
  return `${eok.toLocaleString()}억`;
}
function fmtPct(r) {
  if (r == null || isNaN(r)) return '';
  const cls = r > 0 ? 'up' : r < 0 ? 'down' : '';
  return `<span class="${cls}">${r > 0 ? '+' : ''}${r.toFixed(2)}%</span>`;
}
function fmtDate(iso, withTime) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  let s = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  if (withTime) s += ` ${p(d.getHours())}:${p(d.getMinutes())}`;
  return s;
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- GitHub contents API ---------- */
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gh(path, opts = {}, repo = REPO) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    ...opts,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const err = new Error(detail.message || `GitHub ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ---------- data loading ---------- */
async function getJSON(url) {
  const res = await fetch(`${url}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}
function normalize(p) {
  return { holdings: Array.isArray(p?.holdings) ? p.holdings : [], watchlist: Array.isArray(p?.watchlist) ? p.watchlist : [] };
}

async function loadMarket() {
  try {
    state.market = await getJSON('data/market.json');
    for (const m of ['KOSPI', 'KOSDAQ']) {
      state.market[m].forEach((s, i) => state.byCode.set(s.c, { ...s, m, rank: i + 1 }));
    }
    $('#marketStamp').textContent = `시세 기준 ${fmtDate(state.market.updatedAt, true)} · 출처 네이버 금융 · 평일 08:00–20:00 약 30분 간격 갱신`;
  } catch {
    $('#marketStamp').textContent = '시세 데이터를 불러오지 못했습니다.';
  }
}

function normalizeThoughts(t) {
  return { folders: Array.isArray(t?.folders) ? t.folders : [], posts: Array.isArray(t?.posts) ? t.posts : [] };
}

// Each store is one JSON file in the repo, edited through the GitHub contents API.
const STORES = {
  portfolio: { path: 'data/portfolio.json', normalize },
  thoughts: { path: 'data/thoughts.json', repo: PRIVATE_REPO, private: true, normalize: normalizeThoughts },
  sold: { path: 'data/sold.json', repo: PRIVATE_REPO, private: true, normalize: (s) => ({ sold: Array.isArray(s?.sold) ? s.sold : [] }) },
  trash: { path: 'data/trash.json', repo: PRIVATE_REPO, private: true, normalize: (t) => ({ items: Array.isArray(t?.items) ? t.items : [] }) },
};

async function loadStore(key) {
  const { path, repo = REPO, private: isPrivate, normalize: norm } = STORES[key];
  state.access[key] = 'ok';
  if (canEdit()) {
    try {
      const f = await gh(path, {}, repo);
      state.sha[key] = f.sha;
      state[key] = norm(JSON.parse(b64decode(f.content)));
      return;
    } catch (e) {
      if (isPrivate) {
        // 비공개 저장소는 공개본이 없다. 404/403은 토큰에 그 저장소 권한이 없다는 뜻
        state.sha[key] = null;
        state[key] = norm({});
        state.access[key] = e.status === 401 ? 'badtoken' : 'noaccess';
        return;
      }
      toast(e.status === 401 ? '토큰이 유효하지 않습니다. 편집 설정을 확인하세요.' : 'GitHub에서 불러오지 못해 공개본을 표시합니다.');
    }
  }
  if (isPrivate) { state[key] = norm({}); state.access[key] = 'locked'; return; }
  try { state[key] = norm(await getJSON(path)); } catch { /* keep empty */ }
}
const loadStores = () => Promise.all(Object.keys(STORES).map(loadStore));

async function saveStore(key, message) {
  const body = { message, content: b64encode(JSON.stringify(state[key], null, 2) + '\n') };
  if (state.sha[key]) body.sha = state.sha[key];
  const r = await gh(STORES[key].path, { method: 'PUT', body: JSON.stringify(body) }, STORES[key].repo || REPO);
  state.sha[key] = r.content.sha;
}

function saveErrorMessage(e, repo = REPO) {
  if (e.status === 401) return '토큰이 만료됐거나 올바르지 않습니다. 편집 설정에서 새 토큰을 넣어주세요.';
  if (e.status === 403 || e.status === 404) {
    return `토큰에 쓰기 권한이 없습니다 (GitHub ${e.status}: ${e.message}). 토큰 설정에서 Repository access에 ${repo}를 선택하고, Contents 권한을 "Read and write"로 바꿔주세요.`;
  }
  return `저장에 실패했습니다 (${e.status || '네트워크'}: ${e.message})`;
}

// Apply a change locally, push it to GitHub, roll back on failure.
async function mutate(message, fn, key = 'portfolio') {
  const before = JSON.stringify(state[key]);
  fn(state[key]);
  render();
  try {
    await saveStore(key, message);
    toast('저장했습니다');
    return true;
  } catch (e) {
    state[key] = JSON.parse(before);
    if (e.status === 409 || e.status === 422) {
      toast('다른 곳에서 먼저 수정되었습니다. 최신본을 불러옵니다.');
      await loadStore(key);
    } else {
      state.lastError = saveErrorMessage(e, STORES[key].repo);
      toast(state.lastError, 9000);
    }
    render();
    return false;
  }
}

const quote = (code) => state.byCode.get(code);
const findItem = (list, code) => state[storeOf(list)][list].find((s) => s.code === code);
const listOf = (code) => Object.keys(LISTS).find((l) => findItem(l, code));
// stock.naver.com 주소는 PC·모바일 모두 해당 종목 페이지로 연결된다 (finance.naver.com 옛 주소는 모바일에서 홈으로 튕김)
const naverUrl = (code, page = '') => `https://stock.naver.com/domestic/stock/${code}${page ? `/${page}` : ''}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- views ---------- */
function render() {
  const [tab, sub] = (location.hash || '#news').slice(1).split('/');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  $('.tabs a[data-tab=thoughts]').hidden = !canEdit();
  $('.tabs a[data-tab=sold]').hidden = !canEdit();
  $('.tabs a[data-tab=settings]').hidden = !canEdit();
  const btn = $('#settingsBtn');
  btn.classList.toggle('on', canEdit());
  $('#modeLabel').textContent = canEdit() ? '편집 모드' : '보기 전용';
  if (tab === 'holdings' || tab === 'watchlist') {
    view.innerHTML = renderList(tab);
    if (state.reorder === tab) setupReorder();
  }
  else if (tab === 'top') view.innerHTML = renderTop();
  else if (tab === 'thoughts') view.innerHTML = renderThoughts(sub);
  else if (tab === 'sold') view.innerHTML = renderSold();
  else if (tab === 'settings') view.innerHTML = renderSettings(sub);
  else renderNews();
}

// Drag-to-reorder with pointer events (mouse: whole row, touch: grip only so the page can still scroll).
function setupReorder() {
  const ul = $('#reorderList');
  if (!ul) return;
  let drag = null;
  ul.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (!li || (e.pointerType !== 'mouse' && !e.target.closest('.grip'))) return;
    e.preventDefault();
    drag = li;
    li.classList.add('dragging');
    li.setPointerCapture(e.pointerId);
  });
  ul.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    const next = [...ul.children].find((x) => {
      if (x === drag) return false;
      const r = x.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (next) { if (next !== drag.nextElementSibling) ul.insertBefore(drag, next); }
    else if (ul.lastElementChild !== drag) ul.appendChild(drag);
  });
  const end = () => { drag?.classList.remove('dragging'); drag = null; };
  ul.addEventListener('pointerup', end);
  ul.addEventListener('pointercancel', end);
}

function renderList(list) {
  const items = state.portfolio[list];
  const head = `
    <div class="section-head">
      <div><h1>${LISTS[list]}</h1><p>${items.length}개 종목 · 기록 시점의 주가와 시가총액이 함께 저장됩니다</p></div>
      ${!canEdit() ? '' : state.reorder === list
        ? `<div class="head-actions">
            <button class="btn" data-act="reorder-cancel">취소</button>
            <button class="btn primary" data-act="reorder-done" data-list="${list}">완료</button>
          </div>`
        : `<div class="head-actions">
            ${items.length > 1 ? `<button class="btn" data-act="reorder-start" data-list="${list}">순서변경</button>` : ''}
            <button class="btn primary" data-act="add-stock" data-list="${list}">종목 추가</button>
          </div>`}
    </div>`;
  if (state.reorder === list) {
    return head + `<p class="help">⠿ 손잡이를 끌어 순서를 바꾼 뒤 <b>완료</b>를 누르세요.</p>
      <ul class="reorder" id="reorderList">${items.map((it) => {
        const q = quote(it.code);
        return `<li data-code="${it.code}"><span class="grip" aria-hidden="true">⠿</span>
          <span class="name">${esc(it.name)}</span><span class="meta">${it.code}</span>
          <span class="meta" style="margin-left:auto">${q ? `시총 ${fmtCap(q.cap)}` : ''}</span></li>`;
      }).join('')}</ul>`;
  }
  if (!items.length) {
    return head + `<div class="empty">${canEdit() ? '아직 등록된 종목이 없습니다. 종목 추가로 시작하세요.' : '아직 등록된 종목이 없습니다.'}</div>`;
  }
  return head + `<div class="list">${items.map((it) => stockCard(list, it)).join('')}</div>`;
}

function stockCard(list, it) {
  const q = quote(it.code);
  const notes = [...(it.notes || [])].sort((a, b) => b.at.localeCompare(a.at));
  const open = state.open.has(it.code);
  const other = list === 'holdings' ? 'watchlist' : 'holdings';
  const sold = list === 'sold';
  const tools = !canEdit() ? '' : sold ? `
      <button class="btn small primary" data-act="add-note" data-list="sold" data-code="${it.code}">기록 추가</button>
      <button class="btn small" data-act="unsell" data-code="${it.code}">보유종목으로 되돌리기</button>
      <button class="btn small ghost danger" data-act="remove" data-list="sold" data-code="${it.code}">삭제</button>` : `
      <button class="btn small primary" data-act="add-note" data-list="${list}" data-code="${it.code}">기록 추가</button>
      ${list === 'holdings' ? `<button class="btn small" data-act="sell" data-code="${it.code}">매각</button>` : ''}
      <button class="btn small" data-act="move" data-list="${list}" data-code="${it.code}">${LISTS[other]}으로 이동</button>
      <button class="btn small ghost danger" data-act="remove" data-list="${list}" data-code="${it.code}">삭제</button>`;
  // 처분종목: 매각가와 매각 이후 등락을 함께 보여준다
  const sinceSale = sold && q && it.soldPrice ? ((q.p - it.soldPrice) / it.soldPrice) * 100 : null;
  const soldLine = sold ? `<div class="meta sold-meta">${fmtDate(it.soldAt)} 매각 · 매각가 ${fmtNum(it.soldPrice)}원${sinceSale != null ? ` · 매각 후 ${fmtPct(sinceSale)}` : ''}</div>` : '';
  const noteHtml = notes.length
    ? `<ul class="notes">${notes.map((n) => noteItem(list, it, n, q)).join('')}</ul>`
    : `<div class="help">아직 기록이 없습니다.</div>`;
  return `
    <article class="card${open ? ' open' : ''}" data-code="${it.code}">
      <div class="stock-head" data-act="toggle" data-code="${it.code}">
        <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
        <div>
          <div class="name">${esc(it.name)}<span class="badge">${esc(q?.m || it.market || '')}</span></div>
          <div class="meta">${it.code} · 기록 ${notes.length}건${notes[0] ? ` · 최근 ${fmtDate(notes[0].at)}` : ''}</div>
          ${soldLine}
        </div>
        <div class="price">
          <div>${q ? `${fmtNum(q.p)}원 ${fmtPct(q.r)}` : '<span class="meta">시세 없음</span>'}</div>
          <div class="cap">${q ? `시총 ${fmtCap(q.cap)}` : ''}</div>
        </div>
      </div>
      <div class="stock-body">
        <div class="toolbar">${tools}
          <a class="btn small ghost" href="${naverUrl(it.code)}" target="_blank" rel="noopener">네이버 금융 ↗</a>
        </div>
        ${noteHtml}
      </div>
    </article>`;
}

function noteItem(list, it, n, q) {
  const since = q && n.price ? ((q.p - n.price) / n.price) * 100 : null;
  return `
    <li class="note">
      <div class="note-meta">
        ${n.kind === 'sell' ? '<span class="badge sell-badge">매각</span>' : ''}
        <b>${fmtDate(n.at, true)}</b>
        <span>당시 주가 ${fmtNum(n.price)}원</span>
        <span>시총 ${fmtCap(n.cap)}</span>
        ${since != null ? `<span>이후 ${fmtPct(since)}</span>` : ''}
        ${n.editedAt ? `<span>· ${fmtDate(n.editedAt)} 수정</span>` : ''}
      </div>
      <div class="note-text">${esc(n.text)}</div>
      ${canEdit() ? `<div class="note-actions">
        <button class="btn small ghost" data-act="edit-note" data-list="${list}" data-code="${it.code}" data-id="${n.id}">수정</button>
        <button class="btn small ghost danger" data-act="del-note" data-list="${list}" data-code="${it.code}" data-id="${n.id}">삭제</button>
      </div>` : ''}
    </li>`;
}

function renderTop() {
  const m = state.topMarket;
  const seg = `<div class="seg">${['KOSPI', 'KOSDAQ'].map((k) => `<button data-act="top-market" data-m="${k}" class="${k === m ? 'on' : ''}">${k === 'KOSPI' ? '코스피' : '코스닥'}</button>`).join('')}</div>`;
  const head = `<div class="section-head"><div><h1>주요종목</h1><p>시가총액 상위 100</p></div>${seg}</div>`;
  if (!state.market) return head + '<div class="empty">시세 데이터를 불러오지 못했습니다.</div>';
  const rows = state.market[m].slice(0, 100).map((s, i) => {
    const l = listOf(s.c);
    const mark = l ? `<span class="mark">${l === 'holdings' ? '보유' : '관심'}</span>` : '';
    const add = canEdit() && !l ? `<button class="btn small ghost add" data-act="quick-watch" data-code="${s.c}">+ 관심</button>` : '';
    return `<tr><td>${i + 1}</td>
      <td><a href="${naverUrl(s.c)}" target="_blank" rel="noopener" style="text-decoration:none">${esc(s.n)}</a>${mark}</td>
      <td>${fmtCap(s.cap)}</td><td>${fmtNum(s.p)}</td><td>${fmtPct(s.r)}</td><td>${add}</td></tr>`;
  }).join('');
  return head + `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>종목</th><th>시가총액</th><th>현재가</th><th>등락률</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

const NEWS_TABS = { holdings: '보유종목', watchlist: '관심종목', market: '시장 분석', world: '해외뉴스' };
const WORLD_REGIONS = ['미국', '유럽', '중국', '아시아', '글로벌'];

async function loadNewsDay(date) {
  if (!state.newsCache[date]) {
    const [day, daily, world] = await Promise.all([
      getJSON(`data/news/${date}.json`),
      getJSON(`data/daily/${date}.json`).catch(() => null),
      getJSON(`data/world/${date}.json`).catch(() => null),
    ]);
    state.newsCache[date] = { ...day, daily, world };
  }
  return state.newsCache[date];
}

async function renderNews() {
  const head = (nav) => `<div class="section-head"><div><h1>뉴스</h1><p>보유·관심종목 뉴스와 그 함의, 전날 시장 분석 · 매일 아침 7시 30분</p></div>${nav}</div>`;
  if (!state.newsIndex.length) {
    view.innerHTML = head('') + '<div class="empty">아직 작성된 뉴스 브리핑이 없습니다.</div>';
    return;
  }
  const date = state.newsDate || state.newsIndex[0];
  const idx = state.newsIndex.indexOf(date);
  const nav = `<div class="news-nav">
    <button class="btn small" data-act="news-go" data-d="${state.newsIndex[idx + 1] || ''}" ${idx + 1 >= state.newsIndex.length ? 'disabled' : ''}>‹ 이전</button>
    <select class="field" style="width:auto;padding:5px 8px" data-act="news-pick">${state.newsIndex.map((d) => `<option ${d === date ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <button class="btn small" data-act="news-go" data-d="${state.newsIndex[idx - 1] || ''}" ${idx <= 0 ? 'disabled' : ''}>다음 ›</button>
  </div>`;
  let day = state.newsCache[date];
  if (!day) {
    view.innerHTML = head(nav) + '<div class="empty">불러오는 중…</div>';
    try { day = await loadNewsDay(date); } catch {
      view.innerHTML = head(nav) + '<div class="empty">이 날짜의 브리핑을 불러오지 못했습니다.</div>';
      return;
    }
    if ((location.hash || '#news') !== '#news') return;
  }
  const items = day.items || [];
  const tab = state.newsTab;
  const count = (g) => {
    if (g === 'market') return '';
    const n = g === 'world' ? (day.world?.items || []).length : items.filter((x) => x.group === g).length;
    return ` <span class="count">${n}</span>`;
  };
  const seg = `<div class="seg news-tabs">${Object.entries(NEWS_TABS).map(([k, v]) => `<button data-act="news-tab" data-t="${k}" class="${k === tab ? 'on' : ''}">${v}${count(k)}</button>`).join('')}</div>`;
  let body;
  if (tab === 'market') body = renderMarket(day);
  else if (tab === 'world') body = renderWorld(day.world);
  else {
    const its = items.filter((x) => x.group === tab);
    body = its.length ? `<div class="list">${its.map(newsItem).join('')}</div>` : `<div class="empty">이 날은 ${NEWS_TABS[tab]} 관련 새 뉴스가 없었습니다.</div>`;
  }
  // 오늘의 총평은 보유종목 탭에서만, 탭 선택 바로 아래(종목 뉴스 위)에 보여준다
  const summary = tab === 'holdings' && day.summary
    ? `<div class="card news-summary"><div class="summary-label">오늘의 총평</div>${esc(day.summary)}</div>` : '';
  view.innerHTML = head(nav) + seg + summary + body;
}

function fmtIndicator(i) {
  const isYield = i.kind === 'yield';
  const digits = isYield ? 3 : 2;
  const v = i.value == null ? '-' : i.value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = isYield ? (i.diff ?? 0) : (i.rate ?? 0);
  const cls = sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat';
  const arrow = sign > 0 ? '▲' : sign < 0 ? '▼' : '–';
  const diff = i.diff == null ? '' : Math.abs(i.diff).toLocaleString('ko-KR', { maximumFractionDigits: digits });
  // 금리는 변동폭을 %p로, 나머지는 변동폭과 등락률(%)
  const chg = isYield ? `${arrow} ${diff}%p` : `${arrow} ${diff} (${sign > 0 ? '+' : ''}${(i.rate ?? 0).toFixed(2)}%)`;
  return `<div class="tile">
    <div class="tile-name">${esc(i.name)}</div>
    <div class="tile-value">${v}${i.unit ? `<small>${esc(i.unit)}</small>` : ''}</div>
    <div class="tile-chg ${cls}">${chg}</div>
  </div>`;
}

function renderWorld(world) {
  const items = world?.items || [];
  if (!items.length) return '<div class="empty">이 날짜에는 해외뉴스 요약이 없습니다. 해외뉴스는 매일 아침 7시 50분에 정리됩니다.</div>';
  const regions = [...WORLD_REGIONS, ...new Set(items.map((x) => x.region).filter((r) => !WORLD_REGIONS.includes(r)))];
  return regions.map((r) => {
    const its = items.filter((x) => x.region === r);
    if (!its.length) return '';
    return `<h2 class="region-label">${esc(r)}</h2><div class="list">${its.map((x) => `
      <article class="card news-item">
        <h3><a href="${esc(x.url)}" target="_blank" rel="noopener" class="world-title">${esc(x.title)}</a></h3>
        <p class="implication">${esc(x.summary)}</p>
        <div class="headlines"><span>${esc(x.source || '')}${x.published ? ` · ${fmtDate(x.published, true)}` : ''}${x.original ? ` · <span class="hint">${esc(x.original)}</span>` : ''}</span>
          ${(x.also || []).map((a) => `<div>관련 기사: <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)}</a> <span class="hint">${esc(a.original)}</span></div>`).join('')}</div>
      </article>`).join('')}</div>`;
  }).join('') + '<p class="help" style="margin-top:12px">해외 언론의 무료 RSS 헤드라인·요약을 바탕으로 한글로 정리했습니다. 원문 일부는 유료일 수 있습니다.</p>';
}

function renderMarket(day) {
  const m = day.market || {};
  const indicators = day.daily?.indicators || m.indicators || [];
  const sectors = day.daily?.sectors || m.sectors;
  let html = '';
  if (indicators.length) {
    const groups = [...new Set(indicators.map((i) => i.group))];
    html += `<div class="tiles">${groups.map((g) => `<div class="tile-group"><div class="group-label">${esc(g)}</div><div class="tile-row">${indicators.filter((i) => i.group === g).map(fmtIndicator).join('')}</div></div>`).join('')}</div>`;
  }
  if (sectors?.top?.length) {
    const li = (s) => `<li><span>${esc(s.name)}</span>${fmtPct(s.rate)}</li>`;
    html += `<div class="sector-cols">
      <div class="card sector"><div class="group-label">강세 업종</div><ul>${sectors.top.map(li).join('')}</ul></div>
      <div class="card sector"><div class="group-label">약세 업종</div><ul>${sectors.bottom.map(li).join('')}</ul></div>
    </div>`;
  }
  const sections = m.sections || [];
  if (sections.length) {
    html += `<div class="list">${sections.map((x) => `<article class="card news-item"><h3>${esc(x.title)}</h3><p class="implication">${esc(x.body)}</p></article>`).join('')}</div>`;
  }
  if (day.daily?.fetchedAt) html += `<p class="help" style="margin-top:12px">지표 출처 네이버 금융 · ${fmtDate(day.daily.fetchedAt, true)} 수집 (각 시장의 직전 종가 기준)</p>`;
  return html || '<div class="empty">이 날짜에는 시장 분석이 없습니다. 시장 분석은 2026-10-15 브리핑부터 작성됩니다.</div>';
}

function newsItem(x) {
  const q = quote(x.code);
  // URL이 없는 헤드라인은 해당 종목의 네이버 금융 뉴스 목록으로 연결
  const hl = (x.headlines || []).map((h) => {
    const url = h.url || naverUrl(x.code, 'news');
    const meta = [h.source, h.date].filter(Boolean).map(esc).join(' · ');
    const hint = h.url ? '' : ' <span class="hint">· 종목 뉴스 목록</span>';
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(h.title)}</a>${meta ? ` · ${meta}` : ''}${hint}</li>`;
  }).join('');
  return `<article class="card news-item">
    <h3>${esc(x.name)}<span class="badge">${esc(x.code)}</span>${q ? `<span class="meta" style="font-weight:400;font-size:13px;margin-left:auto">${fmtNum(q.p)}원 ${fmtPct(q.r)}</span>` : ''}</h3>
    <p class="implication">${esc(x.implication)}</p>
    ${hl ? `<ul class="headlines">${hl}</ul>` : ''}
  </article>`;
}

/* ---------- thoughts ---------- */
const folderById = (id) => state.thoughts.folders.find((f) => f.id === id);
const childFolders = (parent) => state.thoughts.folders.filter((f) => (f.parent || null) === (parent || null)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const folderPosts = (folder) => state.thoughts.posts.filter((x) => (x.folder || null) === (folder || null)).sort((a, b) => b.at.localeCompare(a.at));
function folderPath(id) {
  const path = [];
  for (let f = folderById(id); f; f = folderById(f.parent)) path.unshift(f);
  return path;
}
// all descendant folder ids, used to block moving a folder into itself
function descendantIds(id) {
  const out = [];
  for (const c of childFolders(id)) out.push(c.id, ...descendantIds(c.id));
  return out;
}
function countDeep(id) {
  let posts = folderPosts(id).length, folders = 0;
  for (const c of childFolders(id)) { const n = countDeep(c.id); posts += n.posts; folders += 1 + n.folders; }
  return { posts, folders };
}

function renderThoughts(sub) {
  const access = state.access.thoughts;
  if (!canEdit() || access === 'locked') {
    return `<div class="section-head"><div><h1>생각</h1></div></div><div class="empty">🔒 비공개 탭입니다. 편집 모드에서만 볼 수 있습니다.</div>`;
  }
  if (access === 'noaccess' || access === 'badtoken') {
    return `<div class="section-head"><div><h1>생각</h1><p>비공개 저장소 ${PRIVATE_REPO}에 저장됩니다</p></div></div>
      <div class="card news-summary">🔒 지금 토큰으로는 비공개 저장소를 열 수 없습니다.
<a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">GitHub 토큰 설정 ↗</a>에서 이 토큰을 열고
Repository access 목록에 <b>${PRIVATE_REPO}</b>를 추가한 뒤 저장하세요. (Contents: Read and write)
토큰 값은 바뀌지 않으니 다시 넣을 필요 없이 이 페이지를 새로고침하면 됩니다.</div>`.replace(/\n/g, ' ');
  }
  const current = sub && folderById(sub) ? sub : null;
  const path = folderPath(current);
  const crumbs = [`<a href="#thoughts">생각</a>`, ...path.map((f, i) => (i === path.length - 1 ? `<b>${esc(f.name)}</b>` : `<a href="#thoughts/${f.id}">${esc(f.name)}</a>`))].join('<span class="sep">›</span>');
  const actions = canEdit() ? `<div class="head-actions">
      <button class="btn" data-act="folder-new" data-id="${current || ''}">새 폴더</button>
      <button class="btn primary" data-act="post-new" data-id="${current || ''}">글쓰기</button>
    </div>` : '';
  const folderTools = canEdit() && current ? `<span class="crumb-tools">
      <button class="btn small ghost" data-act="folder-rename" data-id="${current}">이름 변경</button>
      <button class="btn small ghost" data-act="folder-move" data-id="${current}">이동</button>
      <button class="btn small ghost danger" data-act="folder-delete" data-id="${current}">폴더 삭제</button>
    </span>` : '';
  const head = `<div class="section-head">
      <div><h1>${current ? esc(path[path.length - 1].name) : '생각'}</h1><p>🔒 비공개 · 종목과 관계없는 생각과 메모 · 작성 시각이 자동으로 기록됩니다</p></div>
      ${actions}
    </div>
    <nav class="crumbs">${crumbs}${folderTools}</nav>`;
  const folders = childFolders(current);
  const posts = folderPosts(current);
  const folderHtml = folders.length ? `<div class="folders">${folders.map((f) => {
    const n = countDeep(f.id);
    return `<a class="folder card" href="#thoughts/${f.id}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <span class="folder-name">${esc(f.name)}</span>
      <span class="meta">${n.folders ? `폴더 ${n.folders} · ` : ''}글 ${n.posts}</span>
    </a>`;
  }).join('')}</div>` : '';
  const postHtml = posts.length ? `<div class="list">${posts.map(postCard).join('')}</div>` : '';
  const empty = !folders.length && !posts.length
    ? `<div class="empty">${current ? '이 폴더는 비어 있습니다.' : '아직 적은 생각이 없습니다.'}${canEdit() ? ' 글쓰기나 새 폴더로 시작하세요.' : ''}</div>` : '';
  return head + folderHtml + postHtml + empty;
}

// 접힌 상태에서는 제목만, 제목을 누르면 본문이 펼쳐진다 (제목이 없으면 첫 줄을 제목처럼 보여준다)
function postCard(x) {
  const open = state.open.has(x.id);
  const heading = x.title ? esc(x.title) : `<span class="untitled">${esc(x.text.split('\n')[0].slice(0, 60))}</span>`;
  return `<article class="card post${open ? ' open' : ''}">
    <button class="post-head" data-act="post-toggle" data-id="${x.id}" aria-expanded="${open}">
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      <span class="post-title">${heading}</span>
      <span class="post-date">${fmtDate(x.at, true)}</span>
    </button>
    <div class="post-body">
      ${x.editedAt ? `<div class="note-meta"><span>${fmtDate(x.editedAt, true)} 수정</span></div>` : ''}
      <div class="note-text">${esc(x.text)}</div>
      ${canEdit() ? `<div class="note-actions">
        <button class="btn small ghost" data-act="post-edit" data-id="${x.id}">수정</button>
        <button class="btn small ghost" data-act="post-move" data-id="${x.id}">이동</button>
        <button class="btn small ghost danger" data-act="post-delete" data-id="${x.id}">삭제</button>
      </div>` : ''}
    </div>
  </article>`;
}

/* ---------- dialogs ---------- */
function openDialog(html, onMount) {
  dialog.innerHTML = `<form method="dialog" class="dlg">${html}</form>`;
  dialog.showModal();
  onMount?.(dialog);
}
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

function addStockDialog(list) {
  openDialog(`
    <h2>${LISTS[list]} 추가</h2>
    <p class="sub">코스피·코스닥 상장 종목을 이름이나 종목코드로 검색하세요.</p>
    <input class="field" id="q" placeholder="예: 삼성전자, 005930" autocomplete="off">
    <ul class="suggest" id="sug"></ul>
    <div class="actions"><button class="btn" value="cancel">닫기</button></div>`, (d) => {
    const input = $('#q', d), sug = $('#sug', d);
    let matches = [], sel = 0;
    const all = state.market ? [...state.market.KOSPI.map((s) => ({ ...s, m: 'KOSPI' })), ...state.market.KOSDAQ.map((s) => ({ ...s, m: 'KOSDAQ' }))].sort((a, b) => b.cap - a.cap) : [];
    const draw = () => {
      sug.innerHTML = matches.map((s, i) => `<li data-i="${i}" class="${i === sel ? 'sel' : ''}">${esc(s.n)} <span>${s.c} · ${s.m} · 시총 ${fmtCap(s.cap)}</span></li>`).join('');
    };
    const pick = async (s) => {
      if (!s) return;
      const existing = listOf(s.c);
      if (existing) { toast(`이미 ${LISTS[existing]}에 있습니다`); return; }
      dialog.close();
      state.open.add(s.c);
      await mutate(`${LISTS[list]} 추가: ${s.n}`, (p) => p[list].push({ code: s.c, name: s.n, market: s.m, addedAt: new Date().toISOString(), notes: [] }));
    };
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      matches = q ? all.filter((s) => s.n.toLowerCase().includes(q) || s.c.startsWith(q)).slice(0, 10) : [];
      sel = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, matches.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(matches[sel]); }
    });
    sug.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) pick(matches[+li.dataset.i]); });
    input.focus();
  });
}

function noteDialog(list, code, id, draft) {
  const it = findItem(list, code);
  const existing = id ? it.notes.find((n) => n.id === id) : null;
  const q = quote(code);
  const snap = existing
    ? `${fmtDate(existing.at, true)} 기록 · 당시 주가 ${fmtNum(existing.price)}원 · 시총 ${fmtCap(existing.cap)}`
    : q ? `지금 저장하면: 주가 ${fmtNum(q.p)}원 · 시총 ${fmtCap(q.cap)} (시세 기준 ${fmtDate(state.market.updatedAt, true)})` : '시세 데이터가 없어 주가·시총 없이 저장됩니다.';
  openDialog(`
    <h2>${esc(it.name)} ${existing ? '기록 수정' : '기록 추가'}</h2>
    <p class="sub">${it.code} · ${LIST_NAMES[list]}</p>
    <div class="snapshot">${snap}</div>
    ${draft != null && state.lastError ? `<p class="error">저장하지 못했습니다. ${esc(state.lastError)}</p>` : ''}
    <textarea class="field" id="txt" placeholder="투자 아이디어, 공부한 내용, 매수·매도 이유 등을 자유롭게 기록하세요.">${esc(draft ?? existing?.text ?? '')}</textarea>
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok" value="ok">저장</button></div>`, (d) => {
    const txt = $('#txt', d);
    txt.focus();
    $('#ok', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const text = txt.value.trim();
      if (!text) { txt.focus(); return; }
      dialog.close();
      let ok;
      if (existing) {
        ok = await mutate(`기록 수정: ${it.name}`, (p) => {
          const n = p[list].find((s) => s.code === code).notes.find((x) => x.id === id);
          n.text = text;
          n.editedAt = new Date().toISOString();
        }, storeOf(list));
      } else {
        ok = await mutate(`기록 추가: ${it.name}`, (p) => {
          p[list].find((s) => s.code === code).notes.push({
            id: uid(),
            at: new Date().toISOString(),
            price: q?.p ?? null,
            cap: q?.cap ?? null,
            quoteAt: state.market?.updatedAt ?? null,
            text,
          });
        }, storeOf(list));
      }
      // 저장 실패 시 쓴 내용을 잃지 않도록 창을 다시 연다
      if (!ok) noteDialog(list, code, id, text);
    });
  });
}

function folderOptions(selected, exclude = []) {
  const opts = [`<option value="" ${!selected ? 'selected' : ''}>생각 (최상위)</option>`];
  const walk = (parent, depth) => {
    for (const f of childFolders(parent)) {
      if (exclude.includes(f.id)) continue;
      opts.push(`<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${'　'.repeat(depth)}└ ${esc(f.name)}</option>`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return opts.join('');
}

function folderDialog(parent, existingId) {
  const existing = existingId ? folderById(existingId) : null;
  const where = folderPath(parent).map((f) => f.name).join(' › ') || '생각';
  openDialog(`
    <h2>${existing ? '폴더 이름 변경' : '새 폴더'}</h2>
    <p class="sub">${existing ? '' : `위치: ${esc(where)}`}</p>
    <input class="field" id="fname" placeholder="폴더 이름" value="${esc(existing?.name || '')}" autocomplete="off">
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok">저장</button></div>`, (d) => {
    const input = $('#fname', d);
    input.focus();
    const save = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      dialog.close();
      if (existing) {
        await mutate(`폴더 이름 변경: ${name}`, (t) => { t.folders.find((f) => f.id === existingId).name = name; }, 'thoughts');
      } else {
        await mutate(`폴더 추가: ${name}`, (t) => { t.folders.push({ id: uid(), name, parent: parent || null, createdAt: new Date().toISOString() }); }, 'thoughts');
      }
    };
    $('#ok', d).addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(e); });
  });
}

function postDialog(folder, id, draft) {
  const existing = id ? state.thoughts.posts.find((x) => x.id === id) : null;
  const where = folderPath(existing ? existing.folder : folder).map((f) => f.name).join(' › ') || '생각';
  openDialog(`
    <h2>${existing ? '글 수정' : '글쓰기'}</h2>
    <p class="sub">${esc(where)} · ${existing ? `${fmtDate(existing.at, true)} 작성` : '저장하는 시각이 자동으로 기록됩니다'}</p>
    ${draft && state.lastError ? `<p class="error">저장하지 못했습니다. ${esc(state.lastError)}</p>` : ''}
    <input class="field" id="ptitle" placeholder="제목 (선택)" value="${esc(draft?.title ?? existing?.title ?? '')}" autocomplete="off" style="margin-bottom:8px">
    <textarea class="field" id="ptext" placeholder="생각을 자유롭게 적으세요.">${esc(draft?.text ?? existing?.text ?? '')}</textarea>
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok">저장</button></div>`, (d) => {
    const title = $('#ptitle', d), text = $('#ptext', d);
    text.focus();
    $('#ok', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const v = { title: title.value.trim(), text: text.value.trim() };
      if (!v.text) { text.focus(); return; }
      dialog.close();
      const ok = existing
        ? await mutate(`생각 수정: ${v.title || fmtDate(existing.at, true)}`, (t) => {
          Object.assign(t.posts.find((x) => x.id === id), v, { editedAt: new Date().toISOString() });
        }, 'thoughts')
        : await mutate(`생각 추가: ${v.title || fmtDate(new Date().toISOString(), true)}`, (t) => {
          t.posts.push({ id: uid(), folder: folder || null, ...v, at: new Date().toISOString() });
        }, 'thoughts');
      if (!ok) postDialog(folder, id, v);
    });
  });
}

function moveDialog(kind, id) {
  const isFolder = kind === 'folder';
  const item = isFolder ? folderById(id) : state.thoughts.posts.find((x) => x.id === id);
  const current = isFolder ? item.parent : item.folder;
  openDialog(`
    <h2>${isFolder ? '폴더 이동' : '글 이동'}</h2>
    <p class="sub">${esc(isFolder ? item.name : item.title || fmtDate(item.at, true))}을(를) 옮길 폴더를 고르세요.</p>
    <select class="field" id="dest">${folderOptions(current || '', isFolder ? [id, ...descendantIds(id)] : [])}</select>
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok">이동</button></div>`, (d) => {
    $('#ok', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const dest = $('#dest', d).value || null;
      dialog.close();
      if (dest === (current || null)) return;
      await mutate(`${isFolder ? '폴더' : '생각'} 이동`, (t) => {
        if (isFolder) t.folders.find((f) => f.id === id).parent = dest;
        else t.posts.find((x) => x.id === id).folder = dest;
      }, 'thoughts');
    });
  });
}

// 설정 탭: 메뉴 목록. 기능을 늘릴 때는 SETTINGS_MENU에 항목을 추가하고 renderSettings에 화면을 붙인다
const SETTINGS_MENU = [
  { key: 'trash', icon: '🗑️', title: '휴지통', desc: () => `삭제한 종목 ${state.trash.items.length}개 · 되살리기와 영구 삭제` },
  { key: 'token', icon: '🔑', title: '편집 권한', desc: () => 'GitHub 토큰 확인·변경, 편집 모드 해제', act: 'open-token' },
];

function renderSettings(sub) {
  if (!canEdit()) return `<div class="section-head"><div><h1>설정</h1></div></div><div class="empty">🔒 편집 모드에서만 볼 수 있습니다.</div>`;
  if (sub === 'trash') return renderTrash();
  return `<div class="section-head"><div><h1>설정</h1><p>🔒 비공개</p></div></div>
    <div class="list">${SETTINGS_MENU.map((m) => (m.act
      ? `<button class="card settings-item" data-act="${m.act}">`
      : `<a class="card settings-item" href="#settings/${m.key}">`) + `
        <span class="settings-icon">${m.icon}</span>
        <span><span class="settings-title">${m.title}</span><span class="meta">${esc(m.desc())}</span></span>
        <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      ${m.act ? '</button>' : '</a>'}`).join('')}</div>`;
}

function renderTrash() {
  const access = state.access.trash;
  const crumbs = `<nav class="crumbs"><a href="#settings">설정</a><span class="sep">›</span><b>휴지통</b></nav>`;
  if (access === 'noaccess' || access === 'badtoken') {
    return `<div class="section-head"><div><h1>휴지통</h1></div></div>${crumbs}
      <div class="card news-summary">🔒 지금 토큰으로는 비공개 저장소(${PRIVATE_REPO})를 열 수 없습니다. GitHub 토큰 설정에서 이 저장소 권한(Contents: Read and write)을 추가한 뒤 새로고침하세요.</div>`;
  }
  const items = state.trash.items;
  const head = `<div class="section-head">
      <div><h1>휴지통</h1><p>🔒 비공개 · 기록이 있는 종목을 삭제하면 이곳에 보관됩니다</p></div>
      ${items.length ? '<div class="head-actions"><button class="btn ghost danger" data-act="trash-empty">휴지통 비우기</button></div>' : ''}
    </div>${crumbs}`;
  if (!items.length) return head + '<div class="empty">휴지통이 비어 있습니다.</div>';
  return head + `<div class="list">${items.map((e) => {
    const notes = [...(e.item.notes || [])].sort((a, b) => b.at.localeCompare(a.at));
    return `<article class="card trash-item">
      <div class="trash-head">
        <div>
          <div class="name">${esc(e.item.name)}<span class="badge">${esc(LIST_NAMES[e.list] || e.list)}</span></div>
          <div class="meta">${e.item.code} · 기록 ${notes.length}건 · ${fmtDate(e.deletedAt, true)} 삭제</div>
          ${notes[0] ? `<div class="trash-preview">${esc(notes[0].text.slice(0, 80))}${notes[0].text.length > 80 ? '…' : ''}</div>` : ''}
        </div>
        <div class="trash-actions">
          <button class="btn small primary" data-act="trash-restore" data-id="${e.id}">되살리기</button>
          <button class="btn small ghost danger" data-act="trash-purge" data-id="${e.id}">영구 삭제</button>
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function sellDialog(code, draft) {
  const it = findItem('holdings', code);
  const q = quote(code);
  openDialog(`
    <h2>${esc(it.name)} 매각</h2>
    <p class="sub">처분종목(비공개)으로 옮기고 기록 ${it.notes?.length || 0}건을 그대로 이어서 관리합니다.</p>
    <div class="snapshot">${q ? `매각 시점으로 저장: 주가 ${fmtNum(q.p)}원 · 시총 ${fmtCap(q.cap)} (시세 기준 ${fmtDate(state.market.updatedAt, true)})` : '시세 데이터가 없어 매각가 없이 저장됩니다.'}</div>
    ${draft != null && state.lastError ? `<p class="error">저장하지 못했습니다. ${esc(state.lastError)}</p>` : ''}
    <textarea class="field" id="memo" placeholder="매각 이유를 적어 두세요 (선택). 매각 기록으로 함께 남습니다.">${esc(draft || '')}</textarea>
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok">매각 처리</button></div>`, (d) => {
    const memo = $('#memo', d);
    memo.focus();
    $('#ok', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const text = memo.value.trim();
      dialog.close();
      const at = new Date().toISOString();
      const sale = { soldAt: at, soldPrice: q?.p ?? null, soldCap: q?.cap ?? null, soldQuoteAt: state.market?.updatedAt ?? null };
      const saleNote = { id: uid(), kind: 'sell', at, price: sale.soldPrice, cap: sale.soldCap, quoteAt: sale.soldQuoteAt, text: text ? `매각 — ${text}` : '매각' };
      // 1) 비공개 처분종목에 먼저 저장 (예전에 처분한 같은 종목이 있으면 기록을 합친다)
      const ok = await mutate(`처분종목 추가: ${it.name}`, (s) => {
        const prev = s.sold.find((x) => x.code === code);
        const notes = [...(prev?.notes || []), ...(it.notes || []), saleNote];
        s.sold = [{ ...it, ...sale, notes }, ...s.sold.filter((x) => x.code !== code)];
      }, 'sold');
      if (!ok) { sellDialog(code, text); return; }
      // 2) 공개 보유종목에서 제거. 실패하면 1)을 되돌린다
      const removed = await mutate(`보유종목 매각: ${it.name}`, (p) => { p.holdings = p.holdings.filter((x) => x.code !== code); });
      if (!removed) {
        await mutate(`처분종목 추가 취소: ${it.name}`, (s) => { s.sold = s.sold.filter((x) => !(x.code === code && x.soldAt === at)); }, 'sold');
        return;
      }
      state.open.add(code);
      toast(`${it.name}을(를) 처분종목으로 옮겼습니다`);
    });
  });
}

function renderSold() {
  const access = state.access.sold;
  if (!canEdit() || access === 'locked') {
    return `<div class="section-head"><div><h1>처분종목</h1></div></div><div class="empty">🔒 비공개 탭입니다. 편집 모드에서만 볼 수 있습니다.</div>`;
  }
  if (access === 'noaccess' || access === 'badtoken') {
    return `<div class="section-head"><div><h1>처분종목</h1></div></div>
      <div class="card news-summary">🔒 지금 토큰으로는 비공개 저장소(${PRIVATE_REPO})를 열 수 없습니다. GitHub 토큰 설정에서 이 저장소 권한(Contents: Read and write)을 추가한 뒤 새로고침하세요.</div>`;
  }
  const items = [...state.sold.sold].sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || ''));
  const head = `<div class="section-head"><div><h1>처분종목</h1><p>🔒 비공개 · ${items.length}개 종목 · 보유종목에서 '매각'을 누르면 기록과 함께 이곳으로 옮겨집니다</p></div></div>`;
  if (!items.length) return head + '<div class="empty">아직 처분한 종목이 없습니다.</div>';
  return head + `<div class="list">${items.map((it) => stockCard('sold', it)).join('')}</div>`;
}

function settingsDialog() {
  const has = canEdit();
  openDialog(`
    <h2>편집 설정</h2>
    <p class="sub">${has ? '이 브라우저는 편집 모드입니다.' : '방문자는 보기만 가능합니다. 소유자는 GitHub 토큰을 입력하면 이 브라우저에서 편집할 수 있습니다.'}</p>
    <div class="help">
      <ol>
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained 토큰 만들기 ↗</a></li>
        <li>Repository access: <b>Only select repositories</b> → <b>${REPO}</b>, <b>${PRIVATE_REPO}</b>(생각 탭, 비공개)</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b></li>
        <li>생성된 토큰을 아래에 붙여넣기</li>
      </ol>
      토큰은 이 브라우저(localStorage)에만 저장되며 다른 곳으로 전송되지 않습니다(GitHub API 제외).
    </div>
    <input class="field" id="tok" type="password" placeholder="github_pat_…" value="${has ? '••••••••' : ''}" autocomplete="off" style="margin-top:12px">
    <div class="actions">
      ${has ? '<button class="btn ghost danger" id="logout">편집 해제</button>' : ''}
      <button class="btn" value="cancel">닫기</button>
      <button class="btn primary" id="save">저장</button>
    </div>`, (d) => {
    $('#logout', d)?.addEventListener('click', async (e) => {
      e.preventDefault();
      setToken('');
      dialog.close();
      state.sha = {};
      await loadStores();
      render();
      toast('편집 모드를 해제했습니다');
    });
    $('#save', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const t = $('#tok', d).value.trim();
      if (!t || t.startsWith('•')) { dialog.close(); return; }
      setToken(t);
      try {
        await gh(STORES.portfolio.path);
        await loadStores();
        dialog.close();
        render();
        toast('편집 모드가 켜졌습니다');
      } catch (err) {
        setToken('');
        toast(err.status === 401 ? '토큰이 올바르지 않습니다' : `확인 실패 (${err.status || '네트워크'})`);
      }
    });
  });
}

/* ---------- events ---------- */
view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, list, code, id } = el.dataset;
  if (act === 'toggle') {
    state.open.has(code) ? state.open.delete(code) : state.open.add(code);
    el.closest('.card').classList.toggle('open');
  } else if (act === 'post-toggle') {
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    const card = el.closest('.post');
    card.classList.toggle('open');
    el.setAttribute('aria-expanded', card.classList.contains('open'));
  } else if (act === 'reorder-start') {
    state.reorder = list;
    render();
  } else if (act === 'reorder-cancel') {
    state.reorder = null;
    render();
  } else if (act === 'reorder-done') {
    const order = [...document.querySelectorAll('#reorderList li')].map((li) => li.dataset.code);
    state.reorder = null;
    if (order.join() === state.portfolio[list].map((s) => s.code).join()) { render(); return; }
    await mutate(`${LISTS[list]} 순서 변경`, (p) => {
      p[list] = order.map((c) => p[list].find((s) => s.code === c)).filter(Boolean);
    });
  } else if (act === 'add-stock') addStockDialog(list);
  else if (act === 'add-note') noteDialog(list, code);
  else if (act === 'edit-note') noteDialog(list, code, id);
  else if (act === 'del-note') {
    if (!confirm('이 기록을 삭제할까요?')) return;
    const it = findItem(list, code);
    await mutate(`기록 삭제: ${it.name}`, (p) => {
      const s = p[list].find((x) => x.code === code);
      s.notes = s.notes.filter((n) => n.id !== id);
    }, storeOf(list));
  } else if (act === 'remove') {
    const it = findItem(list, code);
    const n = it.notes?.length || 0;
    if (!n) {
      if (!confirm(`${it.name}을(를) ${LIST_NAMES[list]}에서 삭제할까요?`)) return;
      await mutate(`${LIST_NAMES[list]} 삭제: ${it.name}`, (p) => { p[list] = p[list].filter((x) => x.code !== code); }, storeOf(list));
      return;
    }
    if (!confirm(`${it.name}을(를) ${LIST_NAMES[list]}에서 삭제할까요?\n기록 ${n}건과 함께 휴지통으로 옮겨지며, 설정 › 휴지통에서 되살릴 수 있습니다.`)) return;
    // 1) 비공개 휴지통에 먼저 보관 → 2) 원래 목록에서 제거. 2)가 실패하면 1)을 되돌린다
    const entry = { id: uid(), list, deletedAt: new Date().toISOString(), item: it };
    if (!await mutate(`휴지통으로 이동: ${it.name}`, (t) => { t.items.unshift(entry); }, 'trash')) return;
    const removed = await mutate(`${LIST_NAMES[list]} 삭제: ${it.name}`, (p) => { p[list] = p[list].filter((x) => x.code !== code); }, storeOf(list));
    if (!removed) await mutate(`휴지통 이동 취소: ${it.name}`, (t) => { t.items = t.items.filter((x) => x.id !== entry.id); }, 'trash');
    else toast(`${it.name}을(를) 휴지통으로 옮겼습니다`);
  } else if (act === 'trash-restore') {
    const entry = state.trash.items.find((x) => x.id === id);
    const { list: to, item } = entry;
    if (findItem(to, item.code)) { toast(`이미 ${LIST_NAMES[to]}에 ${item.name}이(가) 있습니다`); return; }
    if (to !== 'sold' && listOf(item.code)) { toast(`${item.name}은(는) 이미 ${LIST_NAMES[listOf(item.code)]}에 있습니다`); return; }
    // 원래 목록에 먼저 되살리고, 성공하면 휴지통에서 뺀다
    if (!await mutate(`휴지통에서 복구: ${item.name}`, (p) => { p[to].push(item); }, storeOf(to))) return;
    await mutate(`휴지통에서 제외: ${item.name}`, (t) => { t.items = t.items.filter((x) => x.id !== id); }, 'trash');
    toast(`${item.name}을(를) ${LIST_NAMES[to]}으로 되살렸습니다`);
  } else if (act === 'trash-purge') {
    const entry = state.trash.items.find((x) => x.id === id);
    if (!confirm(`${entry.item.name}을(를) 영구 삭제할까요? 기록 ${entry.item.notes?.length || 0}건도 되살릴 수 없게 됩니다.`)) return;
    await mutate(`휴지통 영구 삭제: ${entry.item.name}`, (t) => { t.items = t.items.filter((x) => x.id !== id); }, 'trash');
  } else if (act === 'trash-empty') {
    if (!confirm(`휴지통의 ${state.trash.items.length}개 종목을 모두 영구 삭제할까요? 되살릴 수 없습니다.`)) return;
    await mutate('휴지통 비우기', (t) => { t.items = []; }, 'trash');
  } else if (act === 'open-token') {
    settingsDialog();
  } else if (act === 'sell') sellDialog(code);
  else if (act === 'unsell') {
    const it = findItem('sold', code);
    if (findItem('holdings', code)) { toast('이미 보유종목에 있습니다'); return; }
    if (!confirm(`${it.name}을(를) 다시 보유종목으로 옮길까요? 기록은 그대로 함께 옮겨집니다.`)) return;
    const { soldAt, soldPrice, soldCap, soldQuoteAt, ...rest } = it;
    // 공개 쪽(보유종목)에 먼저 추가하고, 성공하면 비공개 처분종목에서 뺀다
    if (!await mutate(`보유종목 복귀: ${it.name}`, (p) => { p.holdings.push(rest); })) return;
    await mutate(`처분종목에서 제외: ${it.name}`, (s) => { s.sold = s.sold.filter((x) => x.code !== code); }, 'sold');
  } else if (act === 'move') {
    const to = list === 'holdings' ? 'watchlist' : 'holdings';
    const it = findItem(list, code);
    await mutate(`${LISTS[to]}으로 이동: ${it.name}`, (p) => {
      const s = p[list].find((x) => x.code === code);
      p[list] = p[list].filter((x) => x.code !== code);
      p[to].push(s);
    });
  } else if (act === 'quick-watch') {
    const q = quote(code);
    await mutate(`관심종목 추가: ${q.n}`, (p) => p.watchlist.push({ code, name: q.n, market: q.m, addedAt: new Date().toISOString(), notes: [] }));
  } else if (act === 'folder-new') folderDialog(id || null);
  else if (act === 'folder-rename') folderDialog(null, id);
  else if (act === 'folder-move') moveDialog('folder', id);
  else if (act === 'folder-delete') {
    const f = folderById(id);
    const subs = childFolders(id).length, posts = folderPosts(id).length;
    const msg = subs || posts
      ? `'${f.name}' 폴더를 삭제할까요?\n안에 있는 하위 폴더 ${subs}개와 글 ${posts}개는 상위 폴더로 옮겨집니다.`
      : `'${f.name}' 폴더를 삭제할까요?`;
    if (!confirm(msg)) return;
    location.hash = f.parent ? `#thoughts/${f.parent}` : '#thoughts';
    await mutate(`폴더 삭제: ${f.name}`, (t) => {
      t.folders.forEach((x) => { if (x.parent === id) x.parent = f.parent || null; });
      t.posts.forEach((x) => { if (x.folder === id) x.folder = f.parent || null; });
      t.folders = t.folders.filter((x) => x.id !== id);
    }, 'thoughts');
  } else if (act === 'post-new') postDialog(id || null);
  else if (act === 'post-edit') postDialog(null, id);
  else if (act === 'post-move') moveDialog('post', id);
  else if (act === 'post-delete') {
    if (!confirm('이 글을 삭제할까요?')) return;
    await mutate('생각 삭제', (t) => { t.posts = t.posts.filter((x) => x.id !== id); }, 'thoughts');
  } else if (act === 'top-market') {
    state.topMarket = el.dataset.m;
    render();
  } else if (act === 'news-tab') {
    state.newsTab = el.dataset.t;
    render();
  } else if (act === 'news-go' && el.dataset.d) {
    state.newsDate = el.dataset.d;
    render();
  }
});
view.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'news-pick') { state.newsDate = e.target.value; render(); }
});
$('#settingsBtn').addEventListener('click', settingsDialog);
window.addEventListener('hashchange', () => { state.reorder = null; render(); });

(async function init() {
  render();
  const newsIdx = getJSON('data/news/index.json').then((d) => { state.newsIndex = [...(d.dates || [])].sort().reverse(); }).catch(() => {});
  await Promise.all([loadMarket(), loadStores(), newsIdx]);
  render();
})();

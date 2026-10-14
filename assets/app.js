'use strict';

const REPO = 'zzornnum/zzornnum.github.io';
const PORTFOLIO_PATH = 'data/portfolio.json';
const TOKEN_KEY = 'gh_token';
const LISTS = { holdings: '보유종목', watchlist: '관심종목' };

const state = {
  market: null,
  byCode: new Map(),
  portfolio: { holdings: [], watchlist: [] },
  sha: null,
  newsIndex: [],
  newsCache: {},
  newsDate: null,
  topMarket: 'KOSPI',
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- GitHub contents API ---------- */
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...opts,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const err = new Error(`GitHub ${res.status}`);
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

async function loadPortfolio() {
  if (canEdit()) {
    try {
      const f = await gh(PORTFOLIO_PATH);
      state.sha = f.sha;
      state.portfolio = normalize(JSON.parse(b64decode(f.content)));
      return;
    } catch (e) {
      toast(e.status === 401 ? '토큰이 유효하지 않습니다. 편집 설정을 확인하세요.' : 'GitHub에서 불러오지 못해 공개본을 표시합니다.');
    }
  }
  try { state.portfolio = normalize(await getJSON(PORTFOLIO_PATH)); } catch { /* keep empty */ }
}

async function savePortfolio(message) {
  const body = {
    message,
    content: b64encode(JSON.stringify(state.portfolio, null, 2) + '\n'),
    sha: state.sha,
  };
  const r = await gh(PORTFOLIO_PATH, { method: 'PUT', body: JSON.stringify(body) });
  state.sha = r.content.sha;
}

// Apply a change locally, push it to GitHub, roll back on failure.
async function mutate(message, fn) {
  const before = JSON.stringify(state.portfolio);
  fn(state.portfolio);
  render();
  try {
    await savePortfolio(message);
    toast('저장했습니다');
    return true;
  } catch (e) {
    state.portfolio = JSON.parse(before);
    if (e.status === 409 || e.status === 422) {
      toast('다른 곳에서 먼저 수정되었습니다. 최신본을 불러옵니다.');
      await loadPortfolio();
    } else {
      toast(e.status === 401 || e.status === 403 ? '저장 권한이 없습니다. 토큰을 확인하세요.' : '저장에 실패했습니다');
    }
    render();
    return false;
  }
}

const quote = (code) => state.byCode.get(code);
const findItem = (list, code) => state.portfolio[list].find((s) => s.code === code);
const listOf = (code) => Object.keys(LISTS).find((l) => findItem(l, code));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- views ---------- */
function render() {
  const tab = (location.hash || '#news').slice(1);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const btn = $('#settingsBtn');
  btn.classList.toggle('on', canEdit());
  $('#modeLabel').textContent = canEdit() ? '편집 모드' : '보기 전용';
  if (tab === 'holdings' || tab === 'watchlist') view.innerHTML = renderList(tab);
  else if (tab === 'top') view.innerHTML = renderTop();
  else renderNews();
}

function renderList(list) {
  const items = state.portfolio[list];
  const head = `
    <div class="section-head">
      <div><h1>${LISTS[list]}</h1><p>${items.length}개 종목 · 기록 시점의 주가와 시가총액이 함께 저장됩니다</p></div>
      ${canEdit() ? `<button class="btn primary" data-act="add-stock" data-list="${list}">종목 추가</button>` : ''}
    </div>`;
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
  const tools = canEdit() ? `
      <button class="btn small primary" data-act="add-note" data-list="${list}" data-code="${it.code}">기록 추가</button>
      <button class="btn small" data-act="move" data-list="${list}" data-code="${it.code}">${LISTS[other]}으로 이동</button>
      <button class="btn small ghost danger" data-act="remove" data-list="${list}" data-code="${it.code}">삭제</button>` : '';
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
        </div>
        <div class="price">
          <div>${q ? `${fmtNum(q.p)}원 ${fmtPct(q.r)}` : '<span class="meta">시세 없음</span>'}</div>
          <div class="cap">${q ? `시총 ${fmtCap(q.cap)}` : ''}</div>
        </div>
      </div>
      <div class="stock-body">
        <div class="toolbar">${tools}
          <a class="btn small ghost" href="https://finance.naver.com/item/main.naver?code=${it.code}" target="_blank" rel="noopener">네이버 금융 ↗</a>
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
      <td><a href="https://finance.naver.com/item/main.naver?code=${s.c}" target="_blank" rel="noopener" style="text-decoration:none">${esc(s.n)}</a>${mark}</td>
      <td>${fmtCap(s.cap)}</td><td>${fmtNum(s.p)}</td><td>${fmtPct(s.r)}</td><td>${add}</td></tr>`;
  }).join('');
  return head + `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>종목</th><th>시가총액</th><th>현재가</th><th>등락률</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function renderNews() {
  const head = (nav) => `<div class="section-head"><div><h1>뉴스</h1><p>보유·관심종목 관련 뉴스와 그 함의 · 매일 한 번 업데이트</p></div>${nav}</div>`;
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
    try { day = state.newsCache[date] = await getJSON(`data/news/${date}.json`); } catch {
      view.innerHTML = head(nav) + '<div class="empty">이 날짜의 브리핑을 불러오지 못했습니다.</div>';
      return;
    }
    if ((location.hash || '#news') !== '#news') return;
  }
  const items = day.items || [];
  const group = (g) => {
    const its = items.filter((x) => x.group === g);
    if (!its.length) return '';
    return `<div class="group-label">${LISTS[g]}</div><div class="list">${its.map(newsItem).join('')}</div>`;
  };
  view.innerHTML = head(nav)
    + (day.summary ? `<div class="card news-summary">${esc(day.summary)}</div>` : '')
    + group('holdings') + group('watchlist')
    + (items.length ? '' : '<div class="empty">이 날은 관련 뉴스가 없었습니다.</div>');
}

function newsItem(x) {
  const q = quote(x.code);
  const hl = (x.headlines || []).map((h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a> · ${esc(h.source || '')}${h.date ? ` · ${esc(h.date)}` : ''}</li>`).join('');
  return `<article class="card news-item">
    <h3>${esc(x.name)}<span class="badge">${esc(x.code)}</span>${q ? `<span class="meta" style="font-weight:400;font-size:13px;margin-left:auto">${fmtNum(q.p)}원 ${fmtPct(q.r)}</span>` : ''}</h3>
    <p class="implication">${esc(x.implication)}</p>
    ${hl ? `<ul class="headlines">${hl}</ul>` : ''}
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

function noteDialog(list, code, id) {
  const it = findItem(list, code);
  const existing = id ? it.notes.find((n) => n.id === id) : null;
  const q = quote(code);
  const snap = existing
    ? `${fmtDate(existing.at, true)} 기록 · 당시 주가 ${fmtNum(existing.price)}원 · 시총 ${fmtCap(existing.cap)}`
    : q ? `지금 저장하면: 주가 ${fmtNum(q.p)}원 · 시총 ${fmtCap(q.cap)} (시세 기준 ${fmtDate(state.market.updatedAt, true)})` : '시세 데이터가 없어 주가·시총 없이 저장됩니다.';
  openDialog(`
    <h2>${esc(it.name)} ${existing ? '기록 수정' : '기록 추가'}</h2>
    <p class="sub">${it.code} · ${LISTS[list]}</p>
    <div class="snapshot">${snap}</div>
    <textarea class="field" id="txt" placeholder="투자 아이디어, 공부한 내용, 매수·매도 이유 등을 자유롭게 기록하세요.">${esc(existing?.text || '')}</textarea>
    <div class="actions"><button class="btn" value="cancel">취소</button><button class="btn primary" id="ok" value="ok">저장</button></div>`, (d) => {
    const txt = $('#txt', d);
    txt.focus();
    $('#ok', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const text = txt.value.trim();
      if (!text) { txt.focus(); return; }
      dialog.close();
      if (existing) {
        await mutate(`기록 수정: ${it.name}`, (p) => {
          const n = p[list].find((s) => s.code === code).notes.find((x) => x.id === id);
          n.text = text;
          n.editedAt = new Date().toISOString();
        });
      } else {
        await mutate(`기록 추가: ${it.name}`, (p) => {
          p[list].find((s) => s.code === code).notes.push({
            id: uid(),
            at: new Date().toISOString(),
            price: q?.p ?? null,
            cap: q?.cap ?? null,
            quoteAt: state.market?.updatedAt ?? null,
            text,
          });
        });
      }
    });
  });
}

function settingsDialog() {
  const has = canEdit();
  openDialog(`
    <h2>편집 설정</h2>
    <p class="sub">${has ? '이 브라우저는 편집 모드입니다.' : '방문자는 보기만 가능합니다. 소유자는 GitHub 토큰을 입력하면 이 브라우저에서 편집할 수 있습니다.'}</p>
    <div class="help">
      <ol>
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained 토큰 만들기 ↗</a></li>
        <li>Repository access: <b>Only select repositories</b> → <b>${REPO}</b></li>
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
      state.sha = null;
      await loadPortfolio();
      render();
      toast('편집 모드를 해제했습니다');
    });
    $('#save', d).addEventListener('click', async (e) => {
      e.preventDefault();
      const t = $('#tok', d).value.trim();
      if (!t || t.startsWith('•')) { dialog.close(); return; }
      setToken(t);
      try {
        const f = await gh(PORTFOLIO_PATH);
        state.sha = f.sha;
        state.portfolio = normalize(JSON.parse(b64decode(f.content)));
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
  } else if (act === 'add-stock') addStockDialog(list);
  else if (act === 'add-note') noteDialog(list, code);
  else if (act === 'edit-note') noteDialog(list, code, id);
  else if (act === 'del-note') {
    if (!confirm('이 기록을 삭제할까요?')) return;
    const it = findItem(list, code);
    await mutate(`기록 삭제: ${it.name}`, (p) => {
      const s = p[list].find((x) => x.code === code);
      s.notes = s.notes.filter((n) => n.id !== id);
    });
  } else if (act === 'remove') {
    const it = findItem(list, code);
    if (!confirm(`${it.name}을(를) ${LISTS[list]}에서 삭제할까요? 기록 ${it.notes?.length || 0}건도 함께 삭제됩니다.`)) return;
    await mutate(`${LISTS[list]} 삭제: ${it.name}`, (p) => { p[list] = p[list].filter((x) => x.code !== code); });
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
  } else if (act === 'top-market') {
    state.topMarket = el.dataset.m;
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
window.addEventListener('hashchange', render);

(async function init() {
  render();
  const newsIdx = getJSON('data/news/index.json').then((d) => { state.newsIndex = [...(d.dates || [])].sort().reverse(); }).catch(() => {});
  await Promise.all([loadMarket(), loadPortfolio(), newsIdx]);
  render();
})();

/* 蛙兄X打卡 v0.1.9（窗口底部常驻蛙兄导航 ai-frog.net 宣传入口）
 * 悬浮窗统计当日：点赞 / 回复 / 发帖 / 转发 / 曝光量 / 关注 / 涨粉
 * 计数方式（本机估算，不走 X API）：
 * - 点赞/转发/关注：监听页面上对应按钮的点击（like/unlike、retweet 菜单与确认框、follow/unfollow）
 * - 发帖/回复：监听发帖按钮点击；位于帖子详情页或回复弹窗内计为「回复」，其余计为「发帖」
 * - 曝光量：打开自己主页时，汇总今天所发帖子的浏览量（取当日最大值）；也可在设置里手动校正
 * - 涨粉：打开自己主页时读取粉丝总数，与昨日最后一次记录（无则今日首次记录）之差即为今日涨粉
 * 数据只存本地 chrome.storage.local，不上传。
 */
(() => {
  'use strict';
  if (window.__xatLoaded) return;
  window.__xatLoaded = true;

  const STORE_KEY = 'xat_state_v1';
  const METRICS = [
    { key: 'like',    label: '点赞',   short: '赞', icon: '❤️' },
    { key: 'reply',   label: '回复',   short: '回', icon: '💬' },
    { key: 'post',    label: '发帖',   short: '帖', icon: '✍️' },
    { key: 'retweet', label: '转发',   short: '转', icon: '🔁' },
    { key: 'views',   label: '曝光量', short: '曝', icon: '👁️' },
    { key: 'follow',  label: '关注',   short: '关', icon: '➕' },
    { key: 'gain',    label: '涨粉',   short: '粉', icon: '📈' },
  ];
  const DEFAULT_TARGETS = { like: 20, reply: 10, post: 3, retweet: 5, views: 5000, follow: 20, gain: 10 };

  let state = { targets: { ...DEFAULT_TARGETS }, days: {}, ownHandle: null };
  let pendingRetweet = 0;   // 时间戳：点开转发菜单的时刻
  let pendingUnretweet = 0; // 时间戳：点开取消转发确认的时刻

  const $store = {
    async load() {
      try {
        const got = await chrome.storage.local.get(STORE_KEY);
        if (got && got[STORE_KEY]) state = Object.assign(state, got[STORE_KEY]);
        state.targets = { ...DEFAULT_TARGETS, ...(state.targets || {}) };
        state.days = state.days || {};
      } catch (e) { /* 忽略，使用默认 */ }
    },
    async save() {
      try { await chrome.storage.local.set({ [STORE_KEY]: state }); } catch (e) { /* 忽略 */ }
    },
  };

  function todayKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function dayData(key = todayKey()) {
    if (!state.days[key]) state.days[key] = { like: 0, reply: 0, post: 0, retweet: 0, views: 0, follow: 0, gain: 0, followersTotal: null, followersBaseline: null, followingTotal: null };
    const d = state.days[key];
    if (d.follow === undefined) d.follow = 0;
    if (d.gain === undefined) d.gain = 0;
    if (d.followersTotal === undefined) d.followersTotal = null;
    if (d.followersBaseline === undefined) d.followersBaseline = null;
    if (d.followingTotal === undefined) d.followingTotal = null;
    return d;
  }
  async function bump(metric, delta) {
    const d = dayData();
    d[metric] = Math.max(0, (d[metric] || 0) + delta);
    await $store.save();
    render();
  }

  /* ---------------- 计数：点击监听 ---------------- */
  function isEnabledBtn(btn) {
    return btn && btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled;
  }
  function isReplyContext(btn) {
    if (/\/status\/\d+/.test(location.pathname)) return true;
    const dlg = btn.closest('[role="dialog"]');
    if (dlg && dlg.querySelector('article')) return true;
    return false;
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;

    const likeBtn = t.closest('[data-testid="like"]');
    if (likeBtn) { bump('like', +1); return; }
    const unlikeBtn = t.closest('[data-testid="unlike"]');
    if (unlikeBtn) { bump('like', -1); return; }

    if (t.closest('[data-testid="retweet"]')) { pendingRetweet = Date.now(); return; }
    if (t.closest('[data-testid="unretweet"]')) { pendingUnretweet = Date.now(); return; }
    if (t.closest('[data-testid="retweetConfirm"]')) { bump('retweet', +1); pendingRetweet = 0; return; }
    if (t.closest('[data-testid="unretweetConfirm"]')) { bump('retweet', -1); pendingUnretweet = 0; return; }

    // 转发下拉菜单里的「Repost / 转帖」
    if (pendingRetweet && Date.now() - pendingRetweet < 10000) {
      const item = t.closest('[role="menuitem"], [role="menu"] *, a, div');
      const menu = t.closest('[role="menu"], [data-testid="Dropdown"]');
      const txt = (t.textContent || '').trim();
      if (menu && /^(Repost|转帖|转发)$/.test(txt)) {
        bump('retweet', +1);
        pendingRetweet = 0;
        return;
      }
    }

    // 关注 / 取关（按钮 testid 形如 123456-follow / 123456-unfollow，也含侧栏推荐位）
    const followBtn = t.closest('[data-testid$="-follow"]');
    if (followBtn) { bump('follow', +1); return; }
    const unfollowBtn = t.closest('[data-testid$="-unfollow"]');
    if (unfollowBtn) { bump('follow', -1); return; }

    const tweetBtn = t.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
    if (tweetBtn && isEnabledBtn(tweetBtn)) {
      bump(isReplyContext(tweetBtn) ? 'reply' : 'post', +1);
      return;
    }
  }, true);

  /* ---------------- 曝光量：自己主页汇总今日帖子浏览量 ---------------- */
  function parseCount(text) {
    if (!text) return 0;
    const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*([KkMm万亿]?)/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    const u = m[2];
    if (u === 'K' || u === 'k') n *= 1e3;
    else if (u === 'M' || u === 'm') n *= 1e6;
    else if (u === '万') n *= 1e4;
    else if (u === '亿') n *= 1e8;
    return Math.round(n);
  }
  function detectOwnHandle() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const h = href.replace('/', '').trim();
      if (h) { state.ownHandle = h; return h; }
    }
    // 兜底：自己主页上有「编辑个人资料」入口（指向 /settings/profile），用当前路径第一段认账号
    const seg = (location.pathname.split('/').filter(Boolean)[0] || '');
    const reserved = ['home', 'explore', 'notifications', 'messages', 'bookmarks', 'lists', 'settings', 'search', 'compose', 'i', 'topics', 'communities'];
    if (seg && !reserved.includes(seg) && document.querySelector('a[href="/settings/profile"]')) {
      state.ownHandle = seg;
      return seg;
    }
    return state.ownHandle;
  }
  function onOwnProfile() {
    const h = detectOwnHandle();
    if (!h) return false;
    return new RegExp('^/' + h + '(/(with_replies|media|likes|followers|verified_followers|following))?/?$').test(location.pathname);
  }
  function prevFollowersTotal(tk) {
    const keys = Object.keys(state.days).filter((k) => k < tk).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
      const v = state.days[keys[i]].followersTotal;
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }
  async function scanFollowers() {
    const h = detectOwnHandle();
    if (!h) return;
    // 认证（蓝V）账号的粉丝链接是 /verified_followers，普通账号是 /followers，两个都要认
    const fLink = document.querySelector(`a[href="/${h}/followers"]`)
      || document.querySelector(`a[href="/${h}/verified_followers"]`);
    if (!fLink) return;
    const total = parseCount(fLink.textContent);
    if (!total && total !== 0) return;
    const gLink = document.querySelector(`a[href="/${h}/following"]`);
    const following = gLink ? parseCount(gLink.textContent) : null;
    const d = dayData();
    let changed = false;
    if (d.followersBaseline === null || d.followersBaseline === undefined) {
      const prev = prevFollowersTotal(todayKey());
      d.followersBaseline = prev !== null ? prev : total;
      changed = true;
    }
    if (d.followersTotal !== total) { d.followersTotal = total; changed = true; }
    if (following !== null && d.followingTotal !== following) { d.followingTotal = following; changed = true; }
    const gain = (d.followersTotal || 0) - (d.followersBaseline || 0);
    if (d.gain !== gain) { d.gain = gain; changed = true; }
    if (changed) { await $store.save(); render(); }
  }
  async function scanViews() {
    if (!onOwnProfile()) return;
    const tk = todayKey();
    let sum = 0;
    document.querySelectorAll('article').forEach((art) => {
      const timeEl = art.querySelector('time[datetime]');
      if (!timeEl) return;
      const dt = new Date(timeEl.getAttribute('datetime'));
      if (isNaN(dt) || todayKey(dt) !== tk) return;
      const a = art.querySelector('a[href$="/analytics"]');
      if (!a) return;
      const v = parseCount(a.textContent) || parseCount(a.getAttribute('aria-label'));
      sum += v;
    });
    if (sum > 0) {
      const d = dayData();
      if (sum > (d.views || 0)) {
        d.views = sum;
        d.viewsFromProfileAt = Date.now();
        await $store.save();
        render();
      }
    }
  }
  function scanAll() { scanFollowers(); scanViews(); }
  let scanTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAll, 800);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scanAll, 4000);

  /* ---------------- 悬浮窗 UI（Shadow DOM 隔离样式） ---------------- */
  const host = document.createElement('div');
  host.id = 'xat-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
  <style>
    * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .card { position: fixed; right: 18px; bottom: 18px; width: 272px; z-index: 2147483000;
      max-height: calc(100vh - 24px); display: flex; flex-direction: column;
      background: linear-gradient(180deg, #f2f8fe, #dcecfb); border: 1px solid #bcd7f5; border-radius: 16px;
      box-shadow: 0 8px 28px rgba(30, 80, 140, .22); color: #12314f; overflow: hidden; user-select: none; }
    #main { overflow-y: auto; min-height: 0; scrollbar-width: thin; }
    #main::-webkit-scrollbar { width: 6px; }
    #main::-webkit-scrollbar-thumb { background: #a9c8ec; border-radius: 99px; }
    .head { display: flex; align-items: center; gap: 6px; padding: 7px 12px; cursor: move;
      background: rgba(255,255,255,.55); border-bottom: 1px solid #c4dcf6; }
    .head .title { font-weight: 700; font-size: 13.5px; }
    .head img.logo { width: 19px; height: 19px; border-radius: 5px; display: block; }
    .head .date { font-size: 11px; color: #5b7b9d; margin-left: auto; }
    .head button { border: none; background: transparent; cursor: pointer; font-size: 13px; color: #33608f; padding: 2px 4px; }
    .body { padding: 7px 12px 9px; }
    .row { margin: 4px 0; }
    .row .top { display: flex; font-size: 12.5px; line-height: 1.35; }
    .row .name { font-weight: 600; }
    .row .num { margin-left: auto; font-variant-numeric: tabular-nums; }
    .row .num b { font-size: 13px; }
    .row .done { color: #1d9d5f; font-weight: 700; }
    .bar { height: 4px; background: rgba(255,255,255,.75); border-radius: 99px; margin-top: 2px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: #3b8beb; border-radius: 99px; transition: width .3s; }
    .bar.full i { background: #1d9d5f; }
    .foot { display: flex; gap: 8px; padding: 0 12px 10px; }
    .foot button, .panel button { flex: 1; border: 1px solid #9ec3ee; background: #ffffff; color: #174a75;
      border-radius: 9px; padding: 5px 0; font-size: 12px; cursor: pointer; }
    .foot button:hover, .panel button:hover { background: #eaf3fd; }
    .panel { padding: 10px 12px 12px; border-top: 1px dashed #b8d4f2; background: rgba(255,255,255,.45); }
    .panel h4 { margin: 2px 0 8px; font-size: 13px; }
    .panel label { display: flex; align-items: center; font-size: 12.5px; margin: 6px 0; gap: 6px; }
    .panel label span { width: 52px; }
    .panel .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
    .panel .grid label { margin: 3px 0; }
    .panel .grid label span { width: 34px; flex: none; }
    .panel input { flex: 1; min-width: 0; border: 1px solid #a9c8ec; border-radius: 7px; padding: 4px 6px; font-size: 12.5px; background: #fff; }
    .panel .btnrow { display: flex; gap: 8px; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th, td { border-bottom: 1px solid #c9dff5; padding: 4px 3px; text-align: center; font-variant-numeric: tabular-nums; }
    th { color: #33608f; font-weight: 600; }
    td.d { text-align: left; white-space: nowrap; }
    .ok { color: #1d9d5f; font-weight: 700; }
    .summary { font-size: 12px; margin-top: 8px; color: #174a75; }
    .hint { font-size: 11px; color: #5b7b9d; margin-top: 6px; line-height: 1.5; }
    .hidden { display: none !important; }
    .toast { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%) translateY(10px);
      background: #12314f; color: #fff; font-size: 12.5px; font-weight: 600; padding: 8px 16px; border-radius: 99px;
      opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; white-space: nowrap;
      box-shadow: 0 6px 18px rgba(18, 49, 79, .35); z-index: 10; }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .sitepromo { margin: 0 12px 10px; padding-top: 8px; border-top: 1px dashed #b8d4f2; text-align: center; }
    .sitepromo a { color: #33608f; font-size: 11.5px; font-weight: 600; text-decoration: none; }
    .sitepromo a:hover { text-decoration: underline; }
  </style>
  <div class="card" id="card">
    <div class="head" id="head">
      <img class="logo" id="logoImg" alt="">
      <span class="title">蛙兄X打卡</span>
      <span class="date" id="date"></span>
      <button id="collapse" title="收起/展开">–</button>
    </div>
    <div id="main">
      <div class="body" id="rows"></div>
      <div class="foot">
        <button id="btnSettings">⚙️ 目标设置</button>
        <button id="btnHistory">📅 历史查看</button>
      </div>
      <div class="panel hidden" id="settings"></div>
      <div class="panel hidden" id="history"></div>
      <div class="sitepromo"><a href="https://ai-frog.net" target="_blank" rel="noopener">🌐 蛙兄导航 ai-frog.net · 发现 AI 好东西</a></div>
    </div>
    <div class="toast" id="toast"></div>
  </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const card = $('#card');
  try { $('#logoImg').src = chrome.runtime.getURL('icons/icon48.png'); } catch (e) { /* 图标加载失败不影响功能 */ }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function fmt(n) { return (n || 0).toLocaleString('en-US'); }
  function render() {
    const tk = todayKey();
    const d = dayData(tk);
    $('#date').textContent = tk.slice(5) + ' 今日';
    $('#rows').innerHTML = METRICS.map((m) => {
      const cur = d[m.key] || 0;
      const tgt = state.targets[m.key] || 0;
      const pct = tgt > 0 ? Math.max(0, Math.min(100, Math.round((cur / tgt) * 100))) : 100;
      const done = tgt > 0 && cur >= tgt;
      const extra = m.key === 'gain'
        ? (d.followersTotal !== null && d.followersTotal !== undefined
          ? ` <span style="font-weight:400;color:#5b7b9d;font-size:11px">总粉 ${fmt(d.followersTotal)}</span>`
          : ` <span style="font-weight:400;color:#c0392b;font-size:11px">未读取·打开自己主页</span>`) : '';
      const shown = m.key === 'gain' && cur > 0 ? '+' + fmt(cur) : fmt(cur);
      return `<div class="row">
        <div class="top"><span class="name">${m.icon} ${m.label}${extra}</span>
        <span class="num"><b>${shown}</b> / ${fmt(tgt)} ${done ? '<span class="done">✓</span>' : ''}</span></div>
        <div class="bar ${done ? 'full' : ''}"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
  }

  /* 目标设置面板 */
  function openSettings() {
    const p = $('#settings');
    $('#history').classList.add('hidden');
    if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
    const d = dayData();
    p.innerHTML = `<h4>每日目标</h4><div class="grid">` +
      METRICS.map((m) => `<label><span>${m.label}</span><input type="number" min="0" id="tgt-${m.key}" value="${state.targets[m.key]}"></label>`).join('') + `</div>` +
      `<div class="btnrow"><button id="saveTargets">保存目标</button><button id="resetTargets">恢复默认目标</button></div>
       <h4 style="margin-top:12px;">手动校正</h4>
       <label><span>今日曝光</span><input type="number" min="0" id="manualViews" value="${d.views || 0}"></label>
       <label><span>今日涨粉</span><input type="number" id="manualGain" value="${d.gain || 0}"></label>
       <div class="btnrow"><button id="saveViews">保存校正</button></div>
       <div class="hint">曝光量：打开自己主页时，把今天所发帖子的浏览量加总（取当日最大值）。<br>关注：点关注 +1、取关 −1（只计本浏览器里的操作）。<br>涨粉：打开自己主页（含关注者/正在关注子页）后几秒内自动读粉丝总数，减去昨日最后一次记录（第一天以今日首次读取为基线，当日涨粉从 0 起算）；认证账号的粉丝链接已兼容。涨粉行显示「未读取」就是还没读到，去主页停留几秒即可。掉粉会显示负数。口径与官方后台略有差异，可用手动校正覆盖。</div>`;
    p.classList.remove('hidden');
    $('#saveTargets').onclick = async () => {
      METRICS.forEach((m) => {
        const v = parseInt($('#tgt-' + m.key).value, 10);
        if (!isNaN(v) && v >= 0) state.targets[m.key] = v;
      });
      await $store.save();
      render();
      showToast('✓ 每日目标已保存');
    };
    $('#resetTargets').onclick = async () => {
      state.targets = { ...DEFAULT_TARGETS };
      METRICS.forEach((m) => { const el = $('#tgt-' + m.key); if (el) el.value = state.targets[m.key]; });
      await $store.save();
      render();
      showToast('✓ 已恢复默认目标');
    };
    $('#saveViews').onclick = async () => {
      const dd = dayData();
      const v = parseInt($('#manualViews').value, 10);
      if (!isNaN(v) && v >= 0) dd.views = v;
      const g = parseInt($('#manualGain').value, 10);
      if (!isNaN(g)) {
        dd.gain = g;
        if (dd.followersTotal !== null && dd.followersTotal !== undefined) dd.followersBaseline = dd.followersTotal - g;
      }
      await $store.save();
      render();
      showToast('✓ 校正已保存');
    };
  }

  /* 历史查看面板（自定义范围） */
  function openHistory() {
    const p = $('#history');
    $('#settings').classList.add('hidden');
    if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
    const end = todayKey();
    const startD = new Date(); startD.setDate(startD.getDate() - 6);
    const start = todayKey(startD);
    p.innerHTML = `<h4>查看范围</h4>
      <label><span>从</span><input type="date" id="hStart" value="${start}"></label>
      <label><span>到</span><input type="date" id="hEnd" value="${end}"></label>
      <div class="btnrow"><button id="hQuery">查询</button></div>
      <div id="hResult"></div>
      <div class="btnrow"><button id="hReset" style="color:#c0392b;border-color:#e5a49c;">🗑 清空全部历史记录</button></div>
      <div class="hint">清空后所有日期的计数（含今天）全部归零，不可恢复；每日目标不会被清。</div>`;
    p.classList.remove('hidden');
    const renderHistory = () => {
      const s = $('#hStart').value, e = $('#hEnd').value;
      if (!s || !e || s > e) { $('#hResult').innerHTML = '<div class="hint">请选择正确的日期范围。</div>'; return; }
      const days = [];
      const cur = new Date(e + 'T00:00:00');
      while (todayKey(cur) >= s) { days.push(todayKey(cur)); cur.setDate(cur.getDate() - 1); }
      let fullDays = 0;
      const cell = (key, m) => {
        const dd = state.days[key] || {};
        const cur2 = dd[m.key] || 0;
        const tgt = state.targets[m.key] || 0;
        const ok = tgt > 0 && cur2 >= tgt;
        const shown = m.key === 'gain' && cur2 > 0 ? '+' + fmt(cur2) : fmt(cur2);
        return `<td class="${ok ? 'ok' : ''}">${shown}/${fmt(tgt)}${ok ? ' ✓' : ''}</td>`;
      };
      const rows = days.map((k) => {
        const dd = state.days[k] || {};
        const met = METRICS.filter((m) => (state.targets[m.key] || 0) > 0 && (dd[m.key] || 0) >= state.targets[m.key]).length;
        if (met === METRICS.length) fullDays++;
        return `<tr><td class="d">${k.slice(5)}</td>${METRICS.map((m) => cell(k, m)).join('')}<td>${met}/${METRICS.length}</td></tr>`;
      }).join('');
      $('#hResult').innerHTML =
        `<div style="overflow-x:auto"><table><tr><th>日期</th>${METRICS.map((m) => `<th>${m.short}</th>`).join('')}<th>达标</th></tr>${rows}</table></div>
         <div class="summary">共 ${days.length} 天，全部达标 ${fullDays} 天。表头：赞=点赞 回=回复 帖=发帖 转=转发 曝=曝光 关=关注 粉=涨粉。数字为本插件在本机记录的计数。</div>`;
    };
    $('#hQuery').onclick = renderHistory;
    let resetArmed = false, resetTimer = null;
    $('#hReset').onclick = async () => {
      const btn = $('#hReset');
      if (!resetArmed) {
        resetArmed = true;
        btn.textContent = '⚠️ 再点一次确认清空（不可恢复）';
        btn.style.background = '#fdecea';
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          resetArmed = false;
          btn.textContent = '🗑 清空全部历史记录';
          btn.style.background = '#ffffff';
        }, 3000);
        return;
      }
      clearTimeout(resetTimer);
      resetArmed = false;
      state.days = {};
      await $store.save();
      render();
      renderHistory();
      btn.textContent = '🗑 清空全部历史记录';
      btn.style.background = '#ffffff';
      showToast('✓ 历史记录已清空');
    };
    renderHistory();
  }
  $('#btnSettings').onclick = openSettings;
  $('#btnHistory').onclick = openHistory;

  /* 收起/展开 */
  let collapsed = false;
  $('#collapse').onclick = () => {
    collapsed = !collapsed;
    $('#main').classList.toggle('hidden', collapsed);
    $('#collapse').textContent = collapsed ? '+' : '–';
  };

  /* 拖动 */
  (() => {
    const head = $('#head');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = card.getBoundingClientRect();
      card.style.left = r.left + 'px'; card.style.top = r.top + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; dragging = true;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      card.style.left = (ox + e.clientX - sx) + 'px';
      card.style.top = (oy + e.clientY - sy) + 'px';
    });
    head.addEventListener('pointerup', () => { dragging = false; });
  })();

  /* 跨标签页同步 + 跨日刷新 */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORE_KEY]) { state = Object.assign(state, changes[STORE_KEY].newValue); render(); }
  });
  setInterval(render, 30000);

  (async () => {
    await $store.load();
    render();
    scanAll();
  })();
})();

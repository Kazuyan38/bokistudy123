/* kz-gate — ログイン必須ゲート
 *
 * <head> の先頭で同期読み込みする。ログインしていなければ全画面のログイン画面でアプリを覆う。
 * Supabase Auth（GoTrue）を fetch で直接叩く。SDK・CDN は使わない。
 *
 *   <script src="auth-gate.js" data-app="アプリ名" data-accent="#c9a45c"></script>
 *
 * 保存先は localStorage の kz-gate/session。github.io は同一オリジンなので、
 * 同じゲートを入れたアプリ間ではログインが共有される（1 回ログインすれば他のアプリも通る）。
 * 注意: 静的サイトなので、これは利用者を絞る入口であって、端末内のデータの秘匿ではない。
 */
(function () {
  'use strict';
  if (window.KzGate) return;

  var tag = document.currentScript;
  var APP = (tag && tag.getAttribute('data-app')) || 'アプリ';
  var ACCENT = (tag && tag.getAttribute('data-accent')) || '#d9ae55';

  // anon / publishable キーは公開前提の値。保護は Supabase 側の行レベルセキュリティが担う。
  var CFG = { url: 'https://hpdyoxbtrnebnvzhyieq.supabase.co', key: 'sb_publishable_b0bIMqh5bsYxkPTe0_uVkg_ibv2swRF' };
  var SKEY = 'kz-gate/session', CKEY = 'kz-gate/config';

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var cfg = function () {
    var o = store.get(CKEY) || {};
    return { url: String(o.url || CFG.url).replace(/\/+$/, ''), key: String(o.key || CFG.key) };
  };
  var now = function () { return Math.floor(Date.now() / 1000); };

  /* ---------- Supabase Auth ---------- */
  function call(path, opt) {
    var c = cfg(), o = opt || {};
    var h = { apikey: c.key, 'Content-Type': 'application/json' };
    if (o.token) h.Authorization = 'Bearer ' + o.token;
    return fetch(c.url + path, { method: o.method || 'POST', headers: h, body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) { var err = new Error(); err.status = r.status; err.body = j || {}; throw err; }
          return j || {};
        });
      }, function () { var err = new Error(); err.offline = true; throw err; });
  }
  function toSession(j) {
    if (!j || !j.access_token) return null;
    return {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || (now() + (j.expires_in || 3600)),
      user: { id: j.user && j.user.id, email: j.user && j.user.email }
    };
  }
  function message(e) {
    if (e.offline) return 'ネットワークに接続できません。電波の良い場所でもう一度お試しください。';
    var b = e.body || {}, code = b.error_code || b.code || '', m = String(b.msg || b.message || b.error_description || '');
    if (code === 'invalid_credentials' || /invalid login/i.test(m)) return 'メールアドレスまたはパスワードが違います。';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(m)) return 'メールの確認がまだです。届いた確認メールのリンクを開いてください。';
    if (code === 'user_already_exists' || /already registered/i.test(m)) return 'このメールアドレスは登録済みです。ログインしてください。';
    if (code === 'weak_password' || /password should/i.test(m)) return 'パスワードは8文字以上にしてください。';
    if (code === 'validation_failed' || /valid email|invalid format/i.test(m)) return 'メールアドレスの形式を確認してください。';
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429) return '短時間に試行が続きました。しばらく待ってからお試しください。';
    if (code === 'signup_disabled') return '現在、新規登録を受け付けていません。';
    return '失敗しました（' + (code || e.status || '不明') + '）。時間をおいてもう一度お試しください。';
  }

  var session = store.get(SKEY);
  var timer = null;
  function save(s) { session = s; store.set(SKEY, s); schedule(); }
  function clear() { session = null; store.del(SKEY); if (timer) clearTimeout(timer); }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (!session) return;
    var ms = Math.max(30, session.expires_at - now() - 60) * 1000;
    timer = setTimeout(function () { refresh(); }, Math.min(ms, 2147483000));
  }
  // 失敗が「通信できない」ときは端末内の資格情報を捨てない（圏外でもアプリを開けるように）。
  function refresh() {
    if (!session) return Promise.resolve(false);
    return call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })
      .then(function (j) { var s = toSession(j); if (s) { save(s); return true; } return false; })
      .catch(function (e) {
        if (e.offline || e.status >= 500) return true;
        clear(); lock(); return false;
      });
  }

  /* ---------- 画面 ---------- */
  var root = null, mode = 'login', busy = false, note = '', noteKind = '';
  // 既存アプリの label / input / button / h1 の全体指定に負けないよう、必要な指定は !important で固定する。
  var I = '!important';
  var css = [
    '#kzg{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow:auto;',
    'background:radial-gradient(120% 90% at 50% 0%,#151a2c 0%,#0a0d17 55%,#06080f 100%);color:#e8eaf2;',
    'font:15px/1.7 "Hiragino Sans","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif;letter-spacing:normal;text-align:left;-webkit-font-smoothing:antialiased}',
    '#kzg *{box-sizing:border-box' + I + ';font-family:inherit' + I + ';letter-spacing:normal' + I + ';text-transform:none' + I + '}',
    '#kzg .c{width:100%;max-width:380px;margin:auto;padding:32px 28px 26px;border-radius:20px;background:rgba(255,255,255,.035);',
    'border:1px solid rgba(255,255,255,.09);box-shadow:0 24px 60px rgba(0,0,0,.45)}',
    '#kzg .k{font-size:11px;letter-spacing:.22em' + I + ';color:' + ACCENT + ';text-transform:uppercase' + I + '}',
    '#kzg h1{margin:6px 0 4px' + I + ';padding:0;font-size:22px' + I + ';line-height:1.35;font-weight:700;color:#f3f4fa' + I + ';border:0}',
    '#kzg .s{margin:0 0 22px' + I + ';font-size:13px;color:#9aa1b8}',
    '#kzg label{display:block' + I + ';width:auto' + I + ';margin:0 0 14px' + I + ';padding:0;font-size:12px' + I + ';font-weight:400;color:#aab1c8' + I + ';line-height:1.7}',
    '#kzg .w{display:block' + I + ';position:relative;margin-top:6px}',
    '#kzg input{display:block' + I + ';width:100%' + I + ';max-width:none' + I + ';min-width:0;height:46px' + I + ';margin:0' + I + ';padding:0 14px' + I + ';border-radius:12px' + I + ';border:1px solid rgba(255,255,255,.14)' + I + ';',
    'background:rgba(0,0,0,.35)' + I + ';color:#f3f4fa' + I + ';font-size:16px' + I + ';line-height:normal;box-shadow:none;outline:none}',
    '#kzg input:focus{border-color:' + ACCENT + I + ';box-shadow:0 0 0 3px ' + ACCENT + '33' + I + '}',
    '#kzg .w input{padding-right:62px' + I + '}',
    '#kzg button{margin:0;text-transform:none' + I + ';-webkit-appearance:none;appearance:none}',
    '#kzg .t{position:absolute' + I + ';right:6px;top:6px;width:auto' + I + ';height:34px' + I + ';padding:0 10px' + I + ';border:0' + I + ';border-radius:8px;background:transparent' + I + ';color:#9aa1b8' + I + ';font-size:12px;cursor:pointer;box-shadow:none}',
    '#kzg .b{display:block' + I + ';width:100%' + I + ';height:48px' + I + ';margin:6px 0 0' + I + ';padding:0' + I + ';border:0' + I + ';border-radius:12px' + I + ';background:' + ACCENT + I + ';color:#111' + I + ';font-weight:700;font-size:15px' + I + ';cursor:pointer;box-shadow:none}',
    '#kzg .b:disabled{opacity:.55;cursor:default}',
    '#kzg .l{display:flex' + I + ';justify-content:space-between;gap:8px;margin-top:16px;font-size:13px}',
    '#kzg .l button{border:0' + I + ';background:none' + I + ';padding:6px 0' + I + ';color:#aab1c8' + I + ';font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;box-shadow:none;width:auto' + I + ';height:auto' + I + '}',
    '#kzg .n{margin:0 0 14px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.6}',
    '#kzg .n.e{background:rgba(255,107,107,.12);color:#ffb3b3}',
    '#kzg .n.o{background:rgba(110,220,160,.12);color:#a8efc9}',
    '#kzg .f{margin:18px 0 0' + I + ';font-size:11px;color:#6f7690;text-align:center}',
    // 下端のタブバーに重ならないよう、その少し上に置く
    '#kzg-chip{position:fixed' + I + ';z-index:2147482000;right:max(8px,env(safe-area-inset-right));bottom:calc(max(8px,env(safe-area-inset-bottom)) + 76px);left:auto' + I + ';top:auto' + I + ';',
    'width:auto' + I + ';height:auto' + I + ';max-width:44vw;margin:0;padding:4px 10px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(10,13,23,.78);',
    'color:#c9cee0;font:11px/1.4 system-ui,sans-serif;cursor:pointer;opacity:.45;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#kzg-chip:hover,#kzg-chip:focus{opacity:1;outline:none}',
    'html.kzg-lock,html.kzg-lock body{overflow:hidden' + I + '}'
  ].join('');

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function addStyle() {
    if (document.getElementById('kzg-style')) return;
    var st = document.createElement('style'); st.id = 'kzg-style'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function mount() {
    if (root) return;
    addStyle();
    root = document.createElement('div'); root.id = 'kzg'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    document.documentElement.appendChild(root);
    document.documentElement.classList.add('kzg-lock');
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
  }
  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; note = ''; noteKind = '';
    document.documentElement.classList.remove('kzg-lock');
    chip();
  }

  var TITLES = {
    login: ['ログイン', 'メールアドレスとパスワードを入力してください。'],
    register: ['新規登録', 'メールアドレスとパスワード（8文字以上）を決めてください。'],
    reset: ['パスワードの再設定', '登録したメールアドレスに、再設定用のリンクを送ります。'],
    newpass: ['新しいパスワード', '新しいパスワードを入力してください（8文字以上）。']
  };
  function field(label, name, type, auto, extra) {
    var pw = type === 'password';
    return '<label>' + label + '<span class="w"><input name="' + name + '" type="' + type + '" autocomplete="' + auto + '" required ' + (extra || '') + '>' +
      (pw ? '<button type="button" class="t" data-a="eye" tabindex="-1" aria-label="パスワードを表示">表示</button>' : '') + '</span></label>';
  }
  function draw() {
    if (!root) return;
    var t = TITLES[mode];
    var body = '';
    if (mode === 'login') body = field('メールアドレス', 'email', 'email', 'username', 'inputmode="email" autocapitalize="off" spellcheck="false"') + field('パスワード', 'password', 'password', 'current-password', 'minlength="8"');
    if (mode === 'register') body = field('メールアドレス', 'email', 'email', 'username', 'inputmode="email" autocapitalize="off" spellcheck="false"') + field('パスワード', 'password', 'password', 'new-password', 'minlength="8"');
    if (mode === 'reset') body = field('メールアドレス', 'email', 'email', 'username', 'inputmode="email" autocapitalize="off" spellcheck="false"');
    if (mode === 'newpass') body = field('新しいパスワード', 'password', 'password', 'new-password', 'minlength="8"');
    var btn = { login: 'ログイン', register: '登録する', reset: '再設定メールを送る', newpass: 'パスワードを変更' }[mode];
    var links = '';
    if (mode === 'login') links = '<button type="button" data-a="register">新規登録</button><button type="button" data-a="reset">パスワードを忘れた</button>';
    else if (mode !== 'newpass') links = '<button type="button" data-a="login">ログインへ戻る</button>';
    root.innerHTML = '<form class="c" novalidate><div class="k">' + esc(APP) + '</div><h1>' + t[0] + '</h1><p class="s">' + t[1] + '</p>' +
      (note ? '<div class="n ' + noteKind + '" role="alert">' + esc(note) + '</div>' : '') +
      body + '<button class="b" type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? '送信中…' : btn) + '</button>' +
      (links ? '<div class="l">' + links + '</div>' : '') +
      '<p class="f">このアプリはログインした方だけが使えます</p></form>';
    var first = root.querySelector('input');
    if (first && !busy) first.focus();
  }
  function lock(m) {
    mount();
    mode = m || 'login';
    draw();
  }
  function say(text, kind) { note = text; noteKind = kind; draw(); }

  function onClick(e) {
    var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
    if (!a) return;
    if (a === 'eye') {
      var inp = e.target.previousSibling, show = inp.type === 'password';
      inp.type = show ? 'text' : 'password'; e.target.textContent = show ? '隠す' : '表示';
      return;
    }
    mode = a; note = ''; draw();
  }
  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    var f = e.target, email = f.email ? f.email.value.trim() : '', pw = f.password ? f.password.value : '';
    if (f.email && !/^\S+@\S+\.\S+$/.test(email)) return say('メールアドレスの形式を確認してください。', 'e');
    if (f.password && pw.length < 8) return say('パスワードは8文字以上にしてください。', 'e');
    busy = true; note = ''; draw();
    var back = encodeURIComponent(location.origin + location.pathname);
    var job;
    if (mode === 'login') {
      job = call('/auth/v1/token?grant_type=password', { body: { email: email, password: pw } }).then(function (j) { save(toSession(j)); unmount(); });
    } else if (mode === 'register') {
      job = call('/auth/v1/signup?redirect_to=' + back, { body: { email: email, password: pw } }).then(function (j) {
        var s = toSession(j);
        if (s) { save(s); unmount(); return; }
        mode = 'login'; say('確認メールを送りました。メール内のリンクを開いてからログインしてください。', 'o');
      });
    } else if (mode === 'reset') {
      job = call('/auth/v1/recover?redirect_to=' + back, { body: { email: email, redirect_to: decodeURIComponent(back) } }).then(function () {
        mode = 'login'; say('再設定メールを送りました。届かない場合は迷惑メールもご確認ください。', 'o');
      });
    } else {
      job = call('/auth/v1/user', { method: 'PUT', token: session && session.access_token, body: { password: pw } }).then(function () { mode = 'login'; unmount(); });
    }
    job.catch(function (err) { say(message(err), 'e'); }).then(function () { busy = false; if (root) draw(); });
  }

  /* ---------- ログアウト用の小さなチップ ---------- */
  function chip() {
    var el = document.getElementById('kzg-chip');
    if (!session) { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', chip, { once: true }); return; }
    if (!el) {
      el = document.createElement('button'); el.id = 'kzg-chip'; el.type = 'button';
      el.addEventListener('click', function () { if (confirm((session && session.user.email || '') + ' をログアウトしますか？')) api.signOut(); });
      document.body.appendChild(el);
    }
    el.textContent = 'ログアウト';
    el.title = (session.user.email || '') + ' でログイン中。クリックでログアウト';
  }

  var api = window.KzGate = {
    user: function () { return session && session.user; },
    signOut: function () {
      var tok = session && session.access_token;
      clear(); chip();
      (tok ? call('/auth/v1/logout', { token: tok }) : Promise.resolve()).catch(function () {}).then(function () { mode = 'login'; lock('login'); });
    }
  };

  /* ---------- 起動 ---------- */
  // メールのリンクから戻ったとき（確認・再設定）は URL のハッシュにトークンが載っている。
  function fromHash() {
    var h = location.hash || '';
    if (h.indexOf('access_token=') < 0 && h.indexOf('error_description=') < 0) return false;
    var p = {}; h.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (p.error_description) { mode = 'login'; lock('login'); say('リンクが無効か、期限切れです。もう一度お試しください。', 'e'); return true; }
    var s = toSession({ access_token: p.access_token, refresh_token: p.refresh_token, expires_in: Number(p.expires_in) || 3600, user: null });
    if (!s) return false;
    return call('/auth/v1/user', { method: 'GET', token: s.access_token }).then(function (u) {
      s.user = { id: u.id, email: u.email }; save(s);
      if (p.type === 'recovery') { mode = 'newpass'; lock('newpass'); } else { unmount(); }
      return true;
    }, function () { mode = 'login'; lock('login'); say('リンクを確認できませんでした。もう一度お試しください。', 'e'); return true; });
  }

  var viaHash = fromHash();
  if (viaHash) {
    // 非同期で処理中。結果が出るまでは画面を覆っておく。
    if (viaHash.then) { mount(); root.innerHTML = ''; }
  } else if (!session) {
    lock('login');
  } else {
    // 保存済みのログインがあれば通す（圏外でも開ける）。期限切れなら裏で更新し、駄目なら入口に戻す。
    if (session.expires_at - now() < 60) refresh(); else schedule();
    if (document.body) chip(); else document.addEventListener('DOMContentLoaded', chip, { once: true });
  }
  // 開いたままのタブでリンクが貼られた場合（ハッシュだけが変わる）にも対応する。
  window.addEventListener('hashchange', function () {
    var r = fromHash();
    if (r && r.then) { mount(); root.innerHTML = ''; }
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && session && session.expires_at - now() < 60) refresh();
  });
  // 他のタブでログアウト／ログインしたら追従する。
  window.addEventListener('storage', function (e) {
    if (e.key !== SKEY) return;
    session = store.get(SKEY);
    if (!session) { chip(); lock('login'); } else if (root && mode !== 'newpass') { schedule(); unmount(); }
  });
})();

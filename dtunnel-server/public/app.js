/* Painel DTunnel - edicao dos JSONs servidos via gRPC */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const TITLES = {
    configs: 'Conexões',
    categories: 'Categorias',
    cdns: 'Endpoints',
    app_configs: 'Aplicativo',
    texts: 'Textos',
    logs: 'Logs',
    build: 'Build APK',
  };

  const SUBTITLES = {
    configs: 'Gerencie as conexões entregues ao aplicativo.',
    categories: 'Organize as conexões em grupos visíveis no app.',
    cdns: 'Cadastre os domínios/CDNs usados como endpoints.',
    app_configs: 'Crie temas, edite a interface e escolha qual será entregue ao aplicativo.',
    texts: 'Edite os textos exibidos na interface do app.',
    logs: 'Acompanhe o log do servidor gRPC em tempo real.',
    build: 'Gere o APK nesta VPS e baixe o arquivo pronto.',
  };

  const PRIMARY = {
    configs: 'name',
    categories: 'name',
    cdns: 'name',
    app_configs: 'name',
    texts: 'label',
  };

  const SUBTITLE = {
    configs: 'id',
    categories: 'id',
    cdns: 'value',
    app_configs: 'type',
    texts: 'text',
  };

  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
  const ICON_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>';
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>';

  let current = 'configs';
  let rows = [];
  let dirty = false;
  let appThemes = [];
  let activeThemeId = null;
  let editingThemeId = null;
  let editingThemeName = '';
  let schema = null;
  let categories = [];
  let cdns = [];
  const SCHEMA_FIELDS = new Map();
  let editIdx = null;
  let editorDraft = null;
  let editorIsNew = false;

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function fmt(v) {
    if (Array.isArray(v)) return v.join(', ');
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  const deepClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function getPath(obj, path) {
    if (!path || path.indexOf('.') < 0) return obj ? obj[path] : undefined;
    let cur = obj;
    for (const p of path.split('.')) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function setPath(obj, path, valor) {
    if (!path || path.indexOf('.') < 0) { obj[path] = valor; return; }
    const partes = path.split('.');
    let cur = obj;
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i];
      if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[partes[partes.length - 1]] = valor;
  }

  function modeLabel(mode) {
    if (schema && schema.modes && schema.modes[mode]) return schema.modes[mode].label;
    return mode || '—';
  }

  function categoryOf(c) {
    const raw = c && c.category;
    const id = (c && c.category_id) ?? (raw && typeof raw === 'object' ? raw.id : undefined);
    const found = categories.find((x) => String(x.id) === String(id));
    const name = (raw && typeof raw === 'object' ? raw.name : raw) || (found && found.name) || '';
    const color = (raw && typeof raw === 'object' && raw.color) || (found && found.color) || '#5b8cff';
    return { id, name, color };
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const a = (parts[0] || '?').charAt(0);
    const b = parts.length > 1 ? parts[1].charAt(0) : '';
    return (a + b).toUpperCase();
  }

  function endpointValue(entry) {
    const raw = String((entry && entry.value) || '').trim();
    if (!raw) return '';
    return raw.includes(':') ? raw : `${raw}:443`;
  }

  function normalizeEndpoint(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.includes(':') ? raw : `${raw}:443`;
  }

  function configSummary(c) {
    const out = [];
    const srv = c.server && typeof c.server === 'object' ? c.server : {};
    const host = srv.host || c.servers || c.host || (typeof c.server === 'string' ? c.server : '');
    const port = srv.port || c.port || '';
    if (host) out.push(port ? `${host}:${port}` : String(host));

    const proxy = c.proxy && typeof c.proxy === 'object' && !Array.isArray(c.proxy) ? c.proxy : {};
    const proxyHost = proxy.host || c.proxy_host || (Array.isArray(c.proxy) ? String(c.proxy[0] || '').split(':')[0] : '');
    const proxyPort = proxy.port || c.proxy_port || '';
    if (proxyHost) out.push(`proxy ${proxyPort ? `${proxyHost}:${proxyPort}` : proxyHost}`);

    const dns = c.dns_server && typeof c.dns_server === 'object' ? c.dns_server : {};
    const dns1 = dns.dns1 || c.dns1 || (Array.isArray(c.dns) ? c.dns[0] : '');
    if (dns1) out.push(`DNS ${dns1}`);

    const tls = c.tls_version || c.tls;
    if (tls) out.push(tls);

    const endpoints = Array.isArray(c.udp_servers) ? c.udp_servers.length : 0;
    if (endpoints) out.push(`${endpoints} endpoint${endpoints > 1 ? 's' : ''}`);

    return out;
  }

  function filtered() {
    const q = $('#search').value.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }

  function updateDirtyBar() {
    const bar = $('#dirtyBar');
    if (bar) bar.classList.toggle('show', !!dirty && current !== 'logs');
  }

  function updateCount() {
    const list = filtered();
    const suffix = dirty ? ' • não salvo' : '';
    $('#count').textContent = `${list.length} de ${rows.length} itens${suffix}`;
    updateDirtyBar();
  }

  async function loadStatus() {
    const el = $('#status');
    try {
      const s = await api('/api/status');
      const active = !!(s.grpc && String(s.grpc).trim());
      el.innerHTML = `<span class="dot ${active ? 'ok' : 'err'}"></span><span>${active ? 'gRPC ativo' : 'gRPC inativo'}</span>`;
      el.title = s.dataDir || '';
    } catch (e) {
      el.innerHTML = `<span class="dot err"></span><span>${esc(e.message)}</span>`;
      el.title = '';
    }
  }

  async function load() {
    if (current === 'logs') return loadLogs();
    if (current === 'build') return loadBuild();
    $('#logs').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    try {
      if (current === 'app_configs') {
        if (editingThemeId) {
          const theme = await api(`/api/app-themes/${encodeURIComponent(editingThemeId)}`);
          editingThemeName = theme.name;
          rows = theme.appConfigs || [];
          dirty = false;
          render();
        } else {
          const result = await api('/api/app-themes');
          appThemes = result.themes || [];
          activeThemeId = result.activeId || null;
          rows = [];
          dirty = false;
          render();
        }
        return;
      }
      if (current === 'configs') {
        const res = await Promise.allSettled([api('/api/categories'), api('/api/cdns')]);
        if (res[0].status === 'fulfilled') categories = res[0].value.data || [];
        if (res[1].status === 'fulfilled') cdns = res[1].value.data || [];
      }
      const { data } = await api(`/api/${current}`);
      rows = data;
      dirty = false;
      render();
    } catch (e) {
      rows = [];
      $('#editor').innerHTML = emptyState('Não foi possível carregar', e.message, false);
      $('#count').textContent = '';
      toast('Erro ao carregar: ' + e.message, 'err');
    }
  }

  async function loadLogs() {
    try {
      const { lines } = await api('/api/logs?n=300');
      $('#logs').textContent = (lines || []).join('\n') || '(sem logs)';
      $('#logs').scrollTop = $('#logs').scrollHeight;
      $('#editor').classList.add('hidden');
      $('#logs').classList.remove('hidden');
      $('#count').textContent = `${(lines || []).length} linhas`;
    } catch (e) {
      toast('Erro ao carregar logs: ' + e.message, 'err');
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => toast('Copiado.', 'ok')).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Copiado.', 'ok');
    } catch (_) {
      toast('Não foi possível copiar.', 'err');
    }
    document.body.removeChild(ta);
  }

  async function loadBuild() {
    $('#logs').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    $('#count').textContent = '';
    dirty = false;
    updateDirtyBar();
    try {
      const info = await api('/api/build-info');
      const host = String(info.host || '').trim();
      const port = info.grpcPort || 8443;
      const syncCmd = `./sync_keys.sh ${host || 'SEU_IP'} root`;
      const buildCmd = `./make_mod.sh ${host || 'SEU_IP'} ${port}`;
      const ok = (v) => v
        ? '<span class="badge mode">OK</span>'
        : '<span class="badge inactive">ausente</span>';
      const canBuild = !!(info.ready && info.builderReady && host && !/SEU_IP|DOMINIO|localhost|0\.0\.0\.0/i.test(host));
      $('#editor').innerHTML = `
        <div class="build-panel">
          <article class="card build-card">
            <div class="build-head">
              <h3>Gerar APK nesta VPS</h3>
              ${canBuild ? '<span class="badge mode">pronto para gerar</span>' : '<span class="badge inactive">verifique os requisitos</span>'}
            </div>
            <p class="build-hint">O APK será compilado apontando para <strong>${esc(host || 'endereço não configurado')}:${esc(port)}</strong>. A compilação pode levar alguns minutos.</p>
            <div class="build-actions">
              <button class="btn primary" id="generateApk" type="button" ${canBuild ? '' : 'disabled'}>Gerar APK agora</button>
              <a class="btn primary hidden" id="downloadBuildApk" href="#">Baixar APK gerado</a>
            </div>
            <p class="build-hint" id="buildProgress">${canBuild ? 'Pronto para iniciar.' : 'Confira as chaves públicas e o compilador APK no status abaixo.'}</p>
            <pre id="buildLog" style="white-space:pre-wrap;max-height:320px;overflow:auto;padding:12px;border-radius:8px;background:#0b1020;margin:12px 0 0;">Aguardando compilação.</pre>
          </article>

          <article class="card build-card">
            <div class="build-head">
              <h3>Status do servidor</h3>
              ${info.ready ? '<span class="badge mode">chaves prontas</span>' : '<span class="badge inactive">chaves incompletas</span>'}
            </div>
            <div class="build-grid">
              <div class="build-stat"><span>Host no APK</span><strong>${esc(host || 'não configurado')}</strong></div>
              <div class="build-stat"><span>Porta gRPC</span><strong>${esc(port)}</strong></div>
              <div class="build-stat"><span>Painel</span><strong>${esc(info.panelPort || '')}</strong></div>
              <div class="build-stat"><span>TLS</span><strong>${info.tls ? 'sim' : 'não (h2c)'}</strong></div>
              <div class="build-stat"><span>ca.pem</span>${ok(info.files && info.files.caPem)}</div>
              <div class="build-stat"><span>server_reply_key.json</span>${ok(info.files && info.files.replyPub)}</div>
              <div class="build-stat"><span>server.pem</span>${ok(info.files && info.files.serverPem)}</div>
              <div class="build-stat"><span>chave privada reply</span>${ok(info.files && info.files.replyPriv)}</div>
              <div class="build-stat"><span>Compilador na VPS</span>${ok(info.builderReady)}</div>
            </div>
          </article>

          <article class="card build-card">
            <div class="build-head"><h3>Chaves públicas</h3></div>
            <p class="build-hint">Disponíveis para o fluxo manual em um PC. A chave privada não é exposta pelo painel.</p>
            <div class="build-actions">
              <a class="btn primary" href="/api/build-keys/ca.pem">Baixar ca.pem</a>
              <a class="btn primary" href="/api/build-keys/server_reply_key.json">Baixar server_reply_key.json</a>
            </div>
          </article>

          <article class="card build-card">
            <div class="build-head"><h3>Compilação manual opcional (PC)</h3></div>
            <p class="build-hint">Se preferir compilar fora da VPS, use estes comandos na pasta <code>dtunnel-mod</code> com o SDK Android e as dependências instaladas:</p>
            <div class="cmd-block">
              <code id="cmdSync">${esc(syncCmd)}</code>
              <button class="btn ghost" type="button" data-copy="${esc(syncCmd)}">Copiar</button>
            </div>
            <div class="cmd-block">
              <code id="cmdBuild">${esc(buildCmd)}</code>
              <button class="btn ghost" type="button" data-copy="${esc(buildCmd)}">Copiar</button>
            </div>
            <div class="cmd-block">
              <code>adb install -r dist/dt_patched_signed.apk</code>
              <button class="btn ghost" type="button" data-copy="adb install -r dist/dt_patched_signed.apk">Copiar</button>
            </div>
          </article>

          <article class="card build-card">
            <div class="build-head"><h3>Observações</h3></div>
            <ul class="build-notes">
              <li>O APK embute o host, a porta, a CA e a chave pública de assinatura.</li>
              <li>Se as chaves do servidor forem regeneradas, gere um novo APK antes de distribuir o app.</li>
              <li>O painel sincroniza somente as chaves públicas para o compilador; a chave privada do servidor nunca é copiada.</li>
              <li>Após instalar, limpe os dados do app se a lista de conexões não atualizar.</li>
            </ul>
          </article>
        </div>`;

      $('#editor').querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', () => copyText(btn.getAttribute('data-copy') || ''));
      });

      const buildButton = $('#generateApk');
      const progress = $('#buildProgress');
      const log = $('#buildLog');
      const download = $('#downloadBuildApk');
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const showJob = (job) => {
        if (progress) {
          const labels = { running: 'Compilando APK…', done: 'Build concluído.', failed: 'A compilação falhou.' };
          progress.textContent = labels[job.status] || 'Preparando compilação…';
        }
        if (log) {
          log.textContent = job.log || (job.status === 'running' ? 'Compilando… aguarde.' : 'Sem saída do compilador.');
          log.scrollTop = log.scrollHeight;
        }
        if (job.status === 'done' && download && job.downloadUrl) {
          download.href = job.downloadUrl;
          download.classList.remove('hidden');
        }
        if (job.status === 'failed' && progress) {
          progress.textContent = `Falha: ${job.error || 'verifique o log da compilação.'}`;
        }
      };
      const watchJob = async (id) => {
        if (buildButton) {
          buildButton.disabled = true;
          buildButton.textContent = 'Compilando…';
        }
        try {
          while (true) {
            const job = await api(`/api/build/${encodeURIComponent(id)}`);
            showJob(job);
            if (job.status === 'done') {
              toast('APK gerado. Use o botão para baixar.', 'ok');
              break;
            }
            if (job.status === 'failed') {
              toast(`Build falhou: ${job.error || 'consulte o log.'}`, 'err');
              break;
            }
            await sleep(2000);
          }
        } finally {
          if (buildButton) {
            buildButton.disabled = !canBuild;
            buildButton.textContent = 'Gerar outro APK';
          }
        }
      };

      if (buildButton && canBuild) {
        buildButton.addEventListener('click', async () => {
          buildButton.disabled = true;
          buildButton.textContent = 'Iniciando…';
          if (progress) progress.textContent = `Solicitando compilação para ${host}:${port}…`;
          if (log) log.textContent = 'Iniciando make_mod.sh…';
          if (download) download.classList.add('hidden');
          try {
            const started = await api('/api/build', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            await watchJob(started.id);
          } catch (e) {
            if (progress) progress.textContent = `Falha ao iniciar/acompanhar o build: ${e.message}`;
            if (log) log.textContent = e.message;
            toast('Erro no build: ' + e.message, 'err');
            buildButton.disabled = false;
            buildButton.textContent = 'Gerar APK agora';
          }
        });
      }

      try {
        const currentJob = await api('/api/build/current');
        if (currentJob.job) {
          showJob(currentJob.job);
          if (currentJob.job.status === 'running' && buildButton && canBuild) {
            watchJob(currentJob.job.id).catch((e) => toast('Erro ao acompanhar build: ' + e.message, 'err'));
          }
        }
      } catch (_) {}
    } catch (e) {
      $('#editor').innerHTML = emptyState('Não foi possível carregar o Build APK', e.message, false);
      toast('Erro no Build APK: ' + e.message, 'err');
    }
  }

  function emptyState(title, text, withAction = true) {
    return `<div class="empty">
      <div class="empty-icon">${ICON_EMPTY}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${withAction ? '<button class="btn primary" data-new type="button">+ Criar agora</button>' : ''}
    </div>`;
  }

  function render() {
    $('#logs').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    if (current === 'configs') renderConfigs();
    else if (current === 'app_configs') editingThemeId ? renderAppConfigs() : renderAppThemes();
    else renderGeneric();
  }

  function themeColor(preview, names, fallback) {
    for (const name of names) {
      const value = preview && preview[name];
      if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim())) return value.trim();
    }
    return fallback;
  }

  function themeLayoutHtml(theme) {
    const configs = Array.isArray(theme && theme.appConfigs) ? theme.appConfigs : [];
    const preview = theme && theme.preview && typeof theme.preview === 'object' ? theme.preview : {};
    const priorities = ['APP_LAYOUT_WEBVIEW', 'APP_WEB_HOME_CONTENT', 'APP_WEB_PAGE_CONTENT', 'APP_WEB_VIEW'];
    for (const name of priorities) {
      const item = configs.find((row) => String(row && row.name || '').trim().toUpperCase() === name);
      const value = item && item.value;
      if (typeof value === 'string' && value.trim()) return value;
      const summarized = preview[name];
      if (typeof summarized === 'string' && summarized.trim()) return summarized;
    }
    const fallback = configs.find((row) => String(row && row.type || '').toUpperCase() === 'HTML' && typeof row.value === 'string' && row.value.trim());
    return fallback ? fallback.value : '';
  }
  function themePhone(theme) {
    const p = theme.preview || {};
    const bg = themeColor(p, ['APP_NATIVE_BACKGROUND_COLOR', 'APP_BACKGROUND_COLOR', 'APP_NATIVE_BACKGROUND_GRADIENT_START_COLOR'], '#111318');
    const card = themeColor(p, ['APP_NATIVE_CARD_COLOR', 'APP_NATIVE_MENU_CARD_COLOR'], '#1c2028');
    const button = themeColor(p, ['APP_NATIVE_BUTTON_COLOR'], '#7157f2');
    const text = themeColor(p, ['APP_NATIVE_TEXT_COLOR', 'APP_NATIVE_MENU_ITEM_TITLE_COLOR'], '#f3f4f6');
    const logo = typeof p.APP_LOGO === 'string' && /^(https?:\/\/|data:image\/)/i.test(p.APP_LOGO) ? `<img class="theme-phone-logo" src="${esc(p.APP_LOGO)}" alt="">` : '<div class="theme-phone-logo-fallback">DT</div>';
    const hasHtml = !!themeLayoutHtml(theme);
    return `<div class="theme-phone" style="--theme-phone-bg:${bg};--theme-phone-card:${card};--theme-phone-button:${button};--theme-phone-text:${text}"><div class="theme-phone-notch"></div><div class="theme-phone-status"><span>9:41</span><span>● ● ▰</span></div><div class="theme-phone-content">${logo}<div class="theme-phone-brand">DTunnel</div>${hasHtml ? '<iframe class="theme-phone-webview-frame" title="Prévia HTML do tema" sandbox=""></iframe>' : `<div class="theme-phone-panel"><div class="theme-phone-select">▤　Selecione uma configuração　⌄</div><div class="theme-phone-field">Usuário</div><div class="theme-phone-field">Senha　　◉</div><button type="button">Conectar</button><div class="theme-phone-status-card">Status da conexão</div></div>`}</div><div class="theme-phone-home"></div></div>`;
  }

  function renderAppThemes() {
    const q = $('#search').value.trim().toLowerCase();
    const list = appThemes.filter((theme) => !q || `${theme.name} ${theme.id}`.toLowerCase().includes(q));
    $('#count').textContent = `${list.length} de ${appThemes.length} temas`;
    updateDirtyBar();
    if (!list.length) {
      $('#editor').innerHTML = `<div class="app-config-page"><div class="app-config-intro"><div><span class="app-config-kicker">PERSONALIZAÇÃO</span><h2>Temas do aplicativo</h2><p>Crie layouts visuais, edite o HTML e escolha qual interface será servida ao APK.</p></div><button class="btn primary" type="button" data-theme-new>+ Criar tema</button></div><div class="theme-empty">${esc(q ? 'Nenhum tema corresponde à busca.' : 'Ainda não há temas.')}</div></div>`;
      return;
    }
    $('#editor').innerHTML = `<div class="app-config-page"><div class="app-config-intro"><div><span class="app-config-kicker">PERSONALIZAÇÃO · APP CONFIG</span><h2>Temas do aplicativo</h2><p>Gerencie os layouts do app. Edite um tema, confira a prévia e ative o que será entregue ao APK.</p></div><div class="theme-gallery-top-actions"><button class="btn ghost" type="button" data-theme-build>▣ Gerar APK</button><button class="btn primary" type="button" data-theme-new>+ Criar tema</button></div></div><div class="theme-gallery">${list.map((theme) => `<article class="theme-card ${theme.active ? 'is-active' : ''}"><header class="theme-card-head"><div><h3>${esc(theme.name)}</h3><code>${esc(theme.id)}</code></div>${theme.active ? '<span class="theme-active-badge">ATIVO NO APK</span>' : ''}</header><div class="theme-card-preview">${themePhone(theme)}</div><footer class="theme-card-actions"><button class="theme-icon-action" type="button" data-theme-action="edit" data-theme-id="${esc(theme.id)}" title="Editar configurações" aria-label="Editar configurações">✎</button><button class="theme-icon-action" type="button" data-theme-action="preview" data-theme-id="${esc(theme.id)}" title="Pré-visualizar no celular" aria-label="Pré-visualizar">▣</button><button class="theme-icon-action" type="button" data-theme-action="html" data-theme-id="${esc(theme.id)}" title="Editar layout HTML" aria-label="Editar HTML">‹›</button>${theme.active ? '<span class="theme-icon-action is-active-icon" title="Tema ativo no APK" aria-label="Ativo">✓</span>' : `<button class="theme-icon-action" type="button" data-theme-action="activate" data-theme-id="${esc(theme.id)}" title="Ativar no APK" aria-label="Ativar">✓</button>`}<button class="theme-icon-action" type="button" data-theme-action="export" data-theme-id="${esc(theme.id)}" title="Exportar tema" aria-label="Exportar">⇧</button><button class="theme-icon-action danger" type="button" data-theme-action="delete" data-theme-id="${esc(theme.id)}" title="Excluir tema" aria-label="Excluir" ${theme.active ? 'disabled' : ''}>▤</button><button class="mini-btn theme-more-action" type="button" data-theme-action="duplicate" data-theme-id="${esc(theme.id)}">Duplicar</button><button class="mini-btn theme-more-action" type="button" data-theme-action="rename" data-theme-id="${esc(theme.id)}">Renomear</button></footer></article>`).join('')}</div></div>`;
    $('#editor').querySelectorAll('.theme-card').forEach((card) => {
      const id = card.querySelector('[data-theme-id]')?.dataset.themeId;
      const theme = list.find((item) => String(item.id) === String(id));
      const frame = card.querySelector('.theme-phone-webview-frame');
      if (frame && theme) frame.srcdoc = themeLayoutHtml(theme);
    });
  }

  function updateAppThemeToolbar() {
    const editing = !!editingThemeId;
    $('#add').classList.toggle('hidden', editing);
    $('#add').textContent = '+ Criar tema';
    $('#save').classList.add('hidden');
    $('#import').classList.toggle('hidden', editing);
    $('#export').classList.toggle('hidden', editing);
    $('#restore').classList.toggle('hidden', true);
  }

  async function editAppTheme(id) {
    editingThemeId = id;
    updateAppThemeToolbar();
    await load();
  }

  async function previewAppTheme(id) {
    try {
      const theme = await api(`/api/app-themes/${encodeURIComponent(id)}`);
      const host = document.createElement('div');
      host.className = 'theme-preview-overlay';
      host.innerHTML = `<section class="theme-preview-dialog"><header><strong>${esc(theme.name)}</strong><button class="icon-btn" type="button" aria-label="Fechar">✕</button></header><div class="theme-preview-stage">${themePhone(theme)}</div></section>`;
      const frame = host.querySelector('.theme-phone-webview-frame');
      if (frame) frame.srcdoc = themeLayoutHtml(theme);
      host.addEventListener('click', (ev) => { if (ev.target === host || ev.target.closest('button')) host.remove(); });
      document.body.appendChild(host);
    } catch (e) { toast('Erro ao abrir prévia: ' + e.message, 'err'); }
  }

  async function editAppThemeHtml(id) {
    try {
      const theme = await api(`/api/app-themes/${encodeURIComponent(id)}`);
      editingThemeId = id;
      editingThemeName = theme.name;
      rows = theme.appConfigs || [];
      dirty = false;
      updateAppThemeToolbar();
      render();
      const index = rows.findIndex((row) => String(row.type).toUpperCase() === 'HTML' && /LAYOUT_WEBVIEW/i.test(row.name || ''));
      if (index < 0) return toast('Este tema não tem campo HTML de layout.', 'err');
      openHtmlConfig(index, false);
    } catch (e) { toast('Erro ao abrir editor HTML: ' + e.message, 'err'); }
  }

  async function createAppTheme(sourceId) {
    const name = prompt('Nome do novo tema:', `Tema ${appThemes.length + 1}`);
    if (name === null || !name.trim()) return;
    try {
      const theme = await api('/api/app-themes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), sourceId }) });
      await load();
      editingThemeId = theme.id;
      updateAppThemeToolbar();
      await load();
      toast('Tema criado. Edite e salve; ele não fica ativo até você escolher Ativar.', 'ok');
    } catch (e) { toast('Erro ao criar tema: ' + e.message, 'err'); }
  }

  async function activateAppTheme(id) {
    try {
      const result = await api(`/api/app-themes/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      appThemes = result.themes || [];
      activeThemeId = result.activeId;
      render();
      toast('Tema ativado. O servidor entregará essa configuração ao APK na próxima atualização.', 'ok');
    } catch (e) { toast('Erro ao ativar tema: ' + e.message, 'err'); }
  }

  async function renameAppTheme(id) {
    const item = appThemes.find((theme) => theme.id === id);
    if (!item) return;
    const name = prompt('Nome do tema:', item.name);
    if (name === null || !name.trim() || name.trim() === item.name) return;
    try {
      await api(`/api/app-themes/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      await load();
      toast('Nome do tema atualizado.', 'ok');
    } catch (e) { toast('Erro ao renomear tema: ' + e.message, 'err'); }
  }

  async function exportAppTheme(id) {
    try {
      const theme = await api(`/api/app-themes/${encodeURIComponent(id)}`);
      const blob = new Blob([JSON.stringify({ name: theme.name, appConfigs: theme.appConfigs }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dtunnel-tema-${String(theme.name || 'tema').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast('Erro ao exportar tema: ' + e.message, 'err'); }
  }

  async function importAppTheme(file) {
    try {
      const payload = JSON.parse(await file.text());
      const theme = await api('/api/app-themes/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await load();
      toast(`Tema “${theme.name}” importado.`, 'ok');
    } catch (e) { toast('Erro ao importar tema: ' + e.message, 'err'); }
  }

  function appConfigGroup(row) {
    const name = String(row.name || '').toUpperCase();
    const known = [
      ['APP_NATIVE_MENU_ITEM_', 'Aplicativo nativo · itens do menu'],
      ['APP_NATIVE_MENU_', 'Aplicativo nativo · menu'],
      ['APP_NATIVE_CONFIG_CATEGORY_', 'Aplicativo nativo · categorias'],
      ['APP_NATIVE_CONFIG_', 'Aplicativo nativo · configurações'],
      ['APP_NATIVE_STATUS_', 'Aplicativo nativo · status'],
      ['APP_NATIVE_CARD_', 'Aplicativo nativo · cards'],
      ['APP_NATIVE_DIALOG_', 'Aplicativo nativo · diálogos'],
      ['APP_NATIVE_INPUT_', 'Aplicativo nativo · campos'],
      ['APP_NATIVE_BUTTON_', 'Aplicativo nativo · botões'],
      ['APP_NATIVE_BACKGROUND_', 'Aplicativo nativo · plano de fundo'],
      ['APP_NATIVE_BORDER_', 'Aplicativo nativo · bordas'],
      ['APP_NATIVE_ELEVATED_', 'Aplicativo nativo · superfícies'],
      ['APP_NATIVE_', 'Aplicativo nativo · outras opções'],
      ['APP_BACKGROUND_', 'Identidade · plano de fundo'],
      ['APP_LOGO', 'Identidade · logotipo'],
      ['APP_', 'Identidade e opções gerais'],
    ];
    const match = known.find(([prefix]) => name.startsWith(prefix));
    if (match) return match[1];
    const prefix = name.split('_').slice(0, 2).join('_');
    return prefix ? `Outras opções · ${prefix}` : 'Outras opções';
  }

  function appConfigLabel(row) {
    const name = String(row.name || 'Opção sem nome');
    const clean = name.replace(/^APP_(NATIVE_)?/, '').replace(/_/g, ' ').trim();
    return clean ? clean.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : name;
  }

  function appConfigControl(row, idx) {
    const type = String(row.type || '').toUpperCase();
    const value = row.value;
    const key = 'value';
    if (type === 'BOOLEAN' || typeof value === 'boolean') {
      return `<label class="app-toggle"><input type="checkbox" data-key="${key}" data-kind="bool" ${value ? 'checked' : ''}><span class="app-toggle-track"></span><span class="app-toggle-label">${value ? 'Ativado' : 'Desativado'}</span></label>`;
    }
    if (type === 'COLOR') {
      const color = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#202123';
      return `<div class="app-color-control"><input class="app-color-picker" type="color" aria-label="Selecionar cor" data-key="${key}" data-kind="color" value="${esc(color)}"><input class="app-value-input" type="text" aria-label="Valor hexadecimal da cor" data-key="${key}" data-kind="color" value="${esc(fmt(value))}" spellcheck="false"><span class="app-type">COR</span></div>`;
    }
    if (type === 'INTEGER' || typeof value === 'number') {
      return `<div class="app-value-control"><input class="app-value-input" type="number" data-key="${key}" data-kind="number" value="${esc(fmt(value))}"><span class="app-type">NÚMERO</span></div>`;
    }
    if (type === 'SELECT' && value && typeof value === 'object' && Array.isArray(value.options)) {
      return `<select class="app-value-input app-select-input" data-key="${key}" data-kind="select">${value.options.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(value.selected) ? 'selected' : ''}>${esc(option.label ?? option.value)}</option>`).join('')}</select>`;
    }
    if (type === 'IMAGE') {
      const src = typeof value === 'string' && /^(https?:\/\/|data:image\/)/i.test(value) ? value : '';
      return `<div class="app-image-control"><input class="app-value-input" type="url" data-key="${key}" data-kind="string" value="${esc(fmt(value))}" placeholder="https://..." aria-label="URL da imagem">${src ? `<img src="${esc(src)}" alt="Prévia da imagem">` : '<small>Informe uma URL de imagem hospedada para visualizar.</small>'}</div>`;
    }
    if (type === 'HTML') {
      return `<div class="app-html-control"><textarea class="app-value-input app-value-area" data-key="${key}" data-kind="string" rows="3" aria-label="Conteúdo HTML">${esc(fmt(value))}</textarea><div class="app-html-actions"><button class="mini-btn" type="button" data-html-action="edit" data-idx="${idx}">‹› Editar HTML</button><button class="mini-btn" type="button" data-html-action="preview" data-idx="${idx}">Visualizar</button><button class="mini-btn" type="button" data-html-action="import" data-idx="${idx}">Importar</button><button class="mini-btn" type="button" data-html-action="clear" data-idx="${idx}">Limpar</button><input class="hidden" type="file" accept=".html,.htm,text/html" data-html-import="${idx}"></div></div>`;
    }
    if (type === 'TEXT' || (typeof value === 'string' && value.length > 90)) {
      return `<textarea class="app-value-input app-value-area" data-key="${key}" data-kind="string" rows="3">${esc(fmt(value))}</textarea>`;
    }
    return `<div class="app-value-control"><input class="app-value-input" type="text" data-key="${key}" data-kind="string" value="${esc(fmt(value))}"><span class="app-type">${esc(type || 'TEXTO')}</span></div>`;
  }

  function renderAppConfigs() {
    const list = filtered();
    updateCount();
    if (!rows.length) {
      $('#editor').innerHTML = emptyState('Nenhuma opção do aplicativo', 'As configurações do aplicativo aparecerão aqui quando forem carregadas.');
      return;
    }
    if (!list.length) {
      $('#editor').innerHTML = emptyState('Nenhuma opção encontrada', 'Ajuste a busca para localizar outra configuração.', false);
      return;
    }

    $('#editor').innerHTML = `<div class="theme-config-overlay"><section class="theme-config-dialog" role="dialog" aria-modal="true" aria-labelledby="themeConfigTitle">
      <header class="theme-config-head"><h2 id="themeConfigTitle">Configurações <small>${esc(editingThemeName || 'Tema')}</small></h2><button class="icon-btn" type="button" data-theme-back aria-label="Fechar">✕</button></header>
      <div class="theme-config-body"><div class="app-config-grid">${list.map((row) => {
        const idx = rows.indexOf(row);
        const type = String(row.type || '').toUpperCase();
        return `<article class="card app-config-option" data-idx="${idx}"><div class="app-option-head"><div class="app-option-title"><h4>${esc(appConfigLabel(row))}</h4></div>${type === 'COLOR' ? `<span class="app-color-preview" style="--preview:${/^#[0-9a-f]{6}$/i.test(String(row.value || '')) ? esc(row.value) : '#202123'}"></span>` : ''}</div><div class="app-fields">${appConfigControl(row, idx)}</div></article>`;
      }).join('')}</div></div>
      <footer class="theme-config-foot"><button class="btn ghost" type="button" data-theme-back>Sair</button><button class="btn success" type="button" data-theme-save>Salvar</button></footer>
    </section></div>`;
    $('#editor').querySelectorAll('.app-color-picker').forEach((picker) => {
      picker.addEventListener('input', () => {
        const text = picker.parentElement.querySelector('.app-value-input');
        if (text) { text.value = picker.value; text.dispatchEvent(new Event('input', { bubbles: true })); }
        const preview = picker.closest('.app-config-option').querySelector('.app-color-preview');
        if (preview) preview.style.setProperty('--preview', picker.value);
      });
    });
    $('#editor').querySelectorAll('.app-toggle input').forEach((toggle) => {
      toggle.addEventListener('change', () => {
        const label = toggle.closest('.app-toggle').querySelector('.app-toggle-label');
        if (label) label.textContent = toggle.checked ? 'Ativado' : 'Desativado';
      });
    });
    $('#editor').querySelectorAll('.app-image-control input').forEach((input) => {
      input.addEventListener('input', () => {
        const holder = input.parentElement;
        let image = holder.querySelector('img');
        let note = holder.querySelector('small');
        if (/^https?:\/\//i.test(input.value.trim()) || /^data:image\//i.test(input.value.trim())) {
          if (!image) { image = document.createElement('img'); image.alt = 'Prévia da imagem'; holder.appendChild(image); }
          image.src = input.value.trim();
          if (note) note.remove();
        } else {
          if (image) image.remove();
          if (!note) { note = document.createElement('small'); note.textContent = 'Informe uma URL de imagem hospedada para visualizar.'; holder.appendChild(note); }
        }
      });
    });
  }

  function openHtmlConfig(idx, previewOnly = false) {
    const row = rows[idx];
    if (!row) return;
    const old = $('#htmlConfigModal');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'htmlConfigModal';
    host.className = 'html-config-overlay';
    host.innerHTML = `<section class="html-config-dialog" role="dialog" aria-modal="true" aria-labelledby="htmlConfigTitle"><header class="html-config-head"><div><span>APLICATIVO · HTML</span><h2 id="htmlConfigTitle">${esc(appConfigLabel(row))}</h2><code>${esc(row.name || '')}</code></div><button class="icon-btn" type="button" data-html-close aria-label="Fechar">✕</button></header><div class="html-config-body"><div class="html-code-pane ${previewOnly ? 'preview-only' : ''}"><label for="htmlConfigSource">Código HTML</label><textarea id="htmlConfigSource" spellcheck="false" ${previewOnly ? 'readonly' : ''}>${esc(fmt(row.value))}</textarea></div><div class="html-preview-pane"><div class="html-preview-title">PRÉ-VISUALIZAÇÃO</div><iframe title="Pré-visualização segura de HTML" sandbox=""></iframe></div></div><footer class="html-config-foot"><div class="html-config-tools">${previewOnly ? '' : '<button class="btn ghost" type="button" data-html-empty>Limpar</button><button class="btn ghost" type="button" data-html-file>Importar HTML</button><input class="hidden" type="file" accept=".html,.htm,text/html" data-html-file-input>'}</div><div class="html-config-actions"><button class="btn ghost" type="button" data-html-close>Fechar</button>${previewOnly ? '' : '<button class="btn primary" type="button" data-html-apply>Aplicar</button>'}</div></footer></section>`;
    document.body.appendChild(host);
    const source = $('#htmlConfigSource', host);
    const frame = $('iframe', host);
    const refreshPreview = () => { frame.srcdoc = source.value; };
    refreshPreview();
    source.addEventListener('input', refreshPreview);
    host.addEventListener('click', (ev) => {
      if (ev.target === host || ev.target.closest('[data-html-close]')) { host.remove(); return; }
      if (ev.target.closest('[data-html-empty]')) { source.value = ''; refreshPreview(); source.focus(); return; }
      if (ev.target.closest('[data-html-file]')) { $('[data-html-file-input]', host).click(); return; }
      if (ev.target.closest('[data-html-apply]')) {
        rows[idx].value = source.value;
        dirty = true;
        host.remove();
        render();
        toast('HTML atualizado. Clique em Salvar para enviar ao aplicativo.', 'ok');
      }
    });
    const fileInput = $('[data-html-file-input]', host);
    if (fileInput) fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      source.value = await file.text();
      refreshPreview();
      toast('HTML importado no editor. Clique em Aplicar e depois em Salvar.', 'ok');
    });
    if (!previewOnly) setTimeout(() => source.focus(), 30);
  }

  function renderConfigs() {
    const list = filtered();
    updateCount();
    if (!rows.length) {
      $('#editor').innerHTML = emptyState('Nenhuma conexão', 'Crie a primeira conexão para o aplicativo receber na próxima atualização.');
      return;
    }
    if (!list.length) {
      $('#editor').innerHTML = emptyState('Nada encontrado', 'Ajuste o filtro para ver as conexões.', false);
      return;
    }

    $('#editor').innerHTML = list
      .map((row) => {
        const idx = rows.indexOf(row);
        const name = row.name || '(sem nome)';
        const mode = row.mode || row.type || '';
        const cat = categoryOf(row);
        const status = row.status || 'ACTIVE';
        const summary = configSummary(row);
        return `<article class="card conn" data-idx="${idx}">
          <div class="conn-avatar" style="--cat:${esc(cat.color)}">${esc(initials(name))}</div>
          <div class="conn-main">
            <div class="conn-title">
              <h3>${esc(name)}</h3>
              <span class="badge mode">${esc(modeLabel(mode))}</span>
              ${status !== 'ACTIVE' ? `<span class="badge ${status === 'DELETED' ? 'deleted' : 'inactive'}">${esc(status)}</span>` : ''}
            </div>
            <div class="chips">
              ${cat.name ? `<span class="chip"><i class="cat-dot" style="--cat:${esc(cat.color)}"></i>${esc(cat.name)}</span>` : ''}
              ${summary.map((item) => `<span class="chip"><code>${esc(item)}</code></span>`).join('')}
            </div>
          </div>
          <div class="conn-actions">
            <button class="icon-btn" data-edit="${idx}" type="button" title="Editar conexão">${ICON_EDIT}</button>
            <button class="icon-btn danger" data-del="${idx}" type="button" title="Excluir conexão">${ICON_TRASH}</button>
          </div>
        </article>`;
      })
      .join('');
  }

  function renderGeneric() {
    const list = filtered();
    updateCount();
    if (!rows.length) {
      $('#editor').innerHTML = emptyState('Nenhum item', 'Use o botão “+ Novo” para criar o primeiro item.');
      return;
    }
    if (!list.length) {
      $('#editor').innerHTML = emptyState('Nada encontrado', 'Ajuste o filtro para ver os itens.', false);
      return;
    }

    $('#editor').innerHTML = list
      .map((row) => {
        const idx = rows.indexOf(row);
        const title = row[PRIMARY[current]] ?? row.name ?? row.label ?? `#${idx}`;
        const sub = row[SUBTITLE[current]];
        return `<article class="card gen" data-idx="${idx}">
          <div class="gen-head">
            <div class="gen-title">
              <h3>${esc(title)}</h3>
              ${sub !== undefined && sub !== '' ? `<span class="chip">${esc(fmt(sub))}</span>` : ''}
            </div>
            <div class="gen-actions">
              <button class="icon-btn danger" data-del="${idx}" type="button" title="Excluir item">${ICON_TRASH}</button>
              <button class="icon-btn" type="button" title="Expandir" tabindex="-1">${ICON_CHEVRON}</button>
            </div>
          </div>
          <div class="gen-body">${fieldsHtml(row)}</div>
        </article>`;
      })
      .join('');
  }

  function fieldsHtml(row) {
    const keys = Object.keys(row).filter((k) => k !== 'id');
    return `<div class="form-grid">${keys.map((k) => cellHtml(row, k)).join('')}</div>`;
  }

  function cellHtml(row, key) {
    const value = row[key];
    const kind = Array.isArray(value) ? 'json' : value === null ? 'json' : typeof value;
    const wide = kind === 'json' || kind === 'object' ||
      (typeof value === 'string' && (value.includes('\n') || value.length > 70)) ||
      ['text', 'description', 'value', 'label'].includes(key);

    if (kind === 'boolean') {
      return `<label class="fld chk"><input type="checkbox" data-key="${esc(key)}" data-kind="bool" ${value ? 'checked' : ''}><span>${esc(key)}</span></label>`;
    }
    if (kind === 'json' || kind === 'object') {
      const text = value === undefined ? '' : JSON.stringify(value, null, 2);
      return `<label class="fld wide"><span>${esc(key)}</span><textarea data-key="${esc(key)}" data-kind="json" rows="${kind === 'object' ? 5 : 3}">${esc(text)}</textarea></label>`;
    }
    if (typeof value === 'string' && (value.includes('\n') || ['text', 'description'].includes(key) || value.length > 90)) {
      return `<label class="fld wide"><span>${esc(key)}</span><textarea data-key="${esc(key)}" data-kind="string" rows="3">${esc(value)}</textarea></label>`;
    }
    return `<label class="fld ${wide ? 'wide' : ''}"><span>${esc(key)}</span>
      <input type="${kind === 'number' ? 'number' : 'text'}" data-key="${esc(key)}" data-kind="${esc(kind)}" value="${esc(fmt(value))}">
    </label>`;
  }

  async function save() {
    if (current === 'logs') return false;
    try {
      if (current === 'app_configs' && editingThemeId) {
        await api(`/api/app-themes/${encodeURIComponent(editingThemeId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appConfigs: rows }),
        });
        dirty = false;
        try {
          const list = await api('/api/app-themes');
          appThemes = list.themes || [];
          activeThemeId = list.activeId || null;
        } catch (_) {}
        render();
        toast(editingThemeId === activeThemeId ? 'Tema ativo salvo; o APK o receberá na próxima atualização.' : 'Tema salvo. Ative-o na galeria quando quiser entregá-lo ao APK.', 'ok');
        return true;
      }
      const body = { data: rows };
      if (!rows.length && current !== 'logs') {
        if (!confirm('Você removeu todos os itens. Confirma apagar tudo?')) return false;
        body.force = true;
      }
      const r = await api(`/api/${current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      dirty = false;
      if (current === 'configs') {
        try { categories = (await api('/api/categories')).data || []; } catch (_) {}
      }
      render();
      toast(`Salvo no servidor: ${r.count} itens. O app recebe na próxima atualização.`, 'ok');
      return true;
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'err');
      return false;
    }
  }

  async function add() {
    if (current === 'configs') {
      openEditor(-1);
      return;
    }
    if (current === 'app_configs' && !editingThemeId) {
      await createAppTheme();
      return;
    }
    if (current === 'categories') {
      rows.push({ id: nextCategoryId(), name: 'Nova categoria', color: '#5b8cff', sorter: rows.length + 1, status: 'ACTIVE' });
    } else if (current === 'cdns') {
      rows.push({ id: randomId(), name: 'Novo endpoint', value: '' });
    } else if (current === 'app_configs') {
      rows.push({ name: 'NOVO_ITEM', type: 'STRING', value: '' });
    } else if (current === 'texts') {
      rows.push({ label: 'NOVO_TEXTO', text: '' });
    }
    dirty = true;
    render();
    const card = $(`.card.gen[data-idx="${rows.length - 1}"]`);
    if (card) card.classList.add('open');
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return String(Date.now());
  }

  function nextCategoryId() {
    let id = Math.floor(Date.now() % 1000000);
    let guard = 0;
    while (categories.some((c) => String(c.id) === String(id)) && guard++ < 1000) {
      id = Math.floor(Math.random() * 1000000) + 1;
    }
    return id;
  }

  function nextConnectionId() {
    const used = new Set(rows.map((r) => String(r.id)));
    let id;
    do { id = Math.floor(Math.random() * 900000000) + 100000000; } while (used.has(String(id)));
    return id;
  }

  function deleteRow(idx) {
    const row = rows[idx];
    const label = row ? (row.name || row.label || row.value || `#${idx}`) : `#${idx}`;
    if (!confirm(`Excluir "${label}"?`)) return;
    rows.splice(idx, 1);
    dirty = true;
    render();
  }

  function fieldValue(c, f) {
    const vazio = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    for (const p of (f.paths || (f.path ? [f.path] : []))) {
      const v = getPath(c, p);
      if (!vazio(v)) return v;
    }
    for (const k of (f.keys || [f.k])) {
      const v = c[k];
      if (!vazio(v)) return v;
    }
    return '';
  }

  function fieldHtml(c, f) {
    const v = fieldValue(c, f);
    const id = `f_${f.k}`;
    let ft = f.t;
    if (ft === 'auto') {
      ft = typeof v === 'boolean' ? 'bool'
        : typeof v === 'number' ? 'number'
        : Array.isArray(v) ? 'json'
        : (v && typeof v === 'object') ? 'json'
        : 'text';
    }

    if (ft === 'bool') {
      return `<label class="fld chk"><input type="checkbox" id="${id}" data-k="${f.k}" ${v ? 'checked' : ''}><span>${esc(f.l)}</span></label>`;
    }

    if (ft === 'category') {
      const catObj = c && typeof c.category === 'object' ? c.category : null;
      const nomeAtual = catObj ? (catObj.name || '') : (typeof c.category === 'string' ? c.category : '');
      let catId = c && c.category_id ? c.category_id : (catObj && catObj.id);
      if (!catId && nomeAtual) {
        const byName = categories.find((cat) => cat.name === nomeAtual);
        if (byName) catId = byName.id;
      }
      const atual = String(catId ?? '');
      const opts = categories
        .map((cat) => `<option value="${esc(cat.id)}" ${String(cat.id) === String(atual) ? 'selected' : ''}>${esc(cat.name || ('#' + cat.id))}</option>`)
        .join('');
      const extra = atual && !categories.some((cat) => String(cat.id) === atual)
        ? `<option value="${esc(atual)}" selected>${esc(nomeAtual || ('#' + atual))}</option>` : '';
      return `<label class="fld">
        <span>${esc(f.l)}</span>
        <select id="${id}" data-k="${f.k}" data-cat="1">
          <option value="">— sem categoria —</option>
          ${extra}
          ${opts}
          <option value="__new__">＋ nova categoria…</option>
        </select>
        <input type="text" id="${id}_new" class="hidden" placeholder="nome da nova categoria">
      </label>`;
    }

    if (ft === 'select') {
      const opts = (f.opts || []).map((o) => `<option ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('');
      const extra = v && !(f.opts || []).map(String).includes(String(v))
        ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '';
      return `<label class="fld"><span>${esc(f.l)}</span><select id="${id}" data-k="${f.k}">${extra}${opts}</select></label>`;
    }

    if (ft === 'textarea') {
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" rows="3" placeholder="${esc(f.h || '')}">${esc(v ?? '')}</textarea></label>`;
    }

    if (ft === 'dns') {
      const d = Array.isArray(v) ? v.join('\n') : (v || '');
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" data-dns="1" rows="2" placeholder="${esc(f.h || '')}">${esc(d)}</textarea></label>`;
    }

    if (ft === 'password') {
      return `<label class="fld"><span>${esc(f.l)}</span>
        <div class="input-wrap">
          <input type="password" id="${id}" data-k="${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.h || '')}" autocomplete="new-password">
          <button class="reveal" type="button" data-reveal title="Mostrar/ocultar">${ICON_EYE}</button>
        </div>
      </label>`;
    }

    if (ft === 'json') {
      const text = v === undefined || v === null || v === '' ? '' : JSON.stringify(v, null, 2);
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" data-json="1" rows="4" placeholder="${esc(f.h || '')}">${esc(text)}</textarea></label>`;
    }

    if (ft === 'cdn') {
      const selected = Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []);
      const selectedNorm = new Set(selected.map(normalizeEndpoint));
      const known = new Set(cdns.map(endpointValue).filter(Boolean));
      const extras = selected.filter((item) => !known.has(normalizeEndpoint(item)));
      const opts = cdns.map((entry) => {
        const val = endpointValue(entry);
        const checked = selectedNorm.has(val) ? 'checked' : '';
        return `<label class="cdn-opt">
          <input type="checkbox" data-cdn-val="${esc(val)}" ${checked}>
          <span class="cdn-text"><strong>${esc(entry.name || 'Endpoint')}</strong><code>${esc(entry.value || '')}</code></span>
        </label>`;
      }).join('');
      return `<div class="fld wide" id="${id}" data-k="${f.k}" data-cdn="1">
        <div class="fld-head">
          <span>${esc(f.l)}</span>
          <div class="mini-actions">
            <button class="mini-btn" type="button" data-cdn-all>Selecionar todos</button>
            <button class="mini-btn" type="button" data-cdn-none>Limpar</button>
          </div>
        </div>
        <div class="cdn-box">
          ${opts ? `<div class="cdn-options">${opts}</div>` : '<p class="muted">Nenhum endpoint cadastrado. Cadastre na aba Endpoints ou digite abaixo.</p>'}
          <label class="cdn-extra">
            <span>Outros endpoints (um por linha, host:porta)</span>
            <textarea data-cdn-extra rows="2" placeholder="exemplo.com:443">${esc(extras.join('\n'))}</textarea>
          </label>
        </div>
      </div>`;
    }

    return `<label class="fld"><span>${esc(f.l)}</span><input type="${ft === 'number' ? 'number' : 'text'}" id="${id}" data-k="${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.h || '')}"></label>`;
  }

  function openEditor(idx) {
    editIdx = idx;
    editorIsNew = idx < 0;
    if (idx < 0) {
      const mode = schema ? schema.defaultMode : 'SSH_PROXY';
      editorDraft = { mode, type: mode };
      const cat = categories[0];
      if (cat) {
        editorDraft.category = { id: cat.id, name: cat.name, color: cat.color, sorter: cat.sorter };
        editorDraft.category_id = cat.id;
      }
    } else {
      editorDraft = deepClone(rows[idx]);
    }
    renderEditor();
  }

  function renderEditor() {
    const c = editorDraft;
    const mode = c.mode || c.type || (schema ? schema.defaultMode : 'SSH_PROXY');
    const def = (schema && schema.modes && schema.modes[mode]) || null;
    const groups = def ? def.groups : [['Campos', []]];

    const seen = new Set();
    const body = groups
      .map(([label, fields]) => {
        const visible = fields.filter((f) => {
          if (seen.has(f.k)) return false;
          seen.add(f.k);
          return true;
        });
        if (!visible.length) return '';
        return `<fieldset>
          <legend>${esc(label)}</legend>
          <div class="form-grid">${visible.map((f) => fieldHtml(c, f)).join('')}</div>
        </fieldset>`;
      })
      .join('');

    const modeEntries = Object.entries((schema && schema.modes) || {});
    if (!modeEntries.some(([k]) => k === mode)) modeEntries.unshift([mode, { label: mode }]);
    const modes = modeEntries
      .map(([k, m]) => `<option value="${esc(k)}" ${k === mode ? 'selected' : ''}>${esc(m.label || k)}</option>`)
      .join('');

    $('#modal').innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <div class="modal-title">
          <h2>Configuração</h2>
          <small>${esc(def ? def.hint : 'modo de conexão')}</small>
        </div>
        <select id="fMode" aria-label="Modo de conexão">${modes}</select>
        <button class="icon-btn" id="mClose" type="button" aria-label="Fechar">✕</button>
      </div>
      ${def ? `<div class="modal-hint">${esc(def.hint)}</div>` : ''}
      <div class="modal-body">${body || '<p class="muted">Nenhum campo disponível para este modo.</p>'}</div>
      <div class="modal-foot">
        <button class="btn ghost" id="mCancel" type="button">Fechar</button>
        <button class="btn primary" id="mSave" type="button">Salvar</button>
      </div>
    </div>`;
    $('#modal').classList.remove('hidden');

    $('#mClose').addEventListener('click', closeEditor);
    $('#mCancel').addEventListener('click', closeEditor);
    $('#mSave').addEventListener('click', saveEditor);
    $('#fMode').addEventListener('change', (ev) => {
      const next = ev.target.value;
      collectForm(editorDraft, true);
      editorDraft.mode = next;
      editorDraft.type = next;
      renderEditor();
    });

    $$('#modal select[data-cat]').forEach((sel) => {
      const input = sel.parentElement.querySelector('input[type=text]');
      const toggle = () => {
        if (input) input.classList.toggle('hidden', sel.value !== '__new__');
      };
      sel.addEventListener('change', toggle);
      toggle();
    });

    $$('#modal [data-reveal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    $$('#modal [data-cdn-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const box = btn.closest('[data-cdn]');
        if (box) $$('input[type=checkbox][data-cdn-val]', box).forEach((cb) => { cb.checked = true; });
      });
    });
    $$('#modal [data-cdn-none]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const box = btn.closest('[data-cdn]');
        if (box) $$('input[type=checkbox][data-cdn-val]', box).forEach((cb) => { cb.checked = false; });
      });
    });
  }

  function closeEditor() {
    $('#modal').classList.add('hidden');
    $('#modal').innerHTML = '';
    editIdx = null;
    editorDraft = null;
    editorIsNew = false;
  }

  function collectForm(target, silent = false) {
    let categoria = null;
    let invalid = false;

    $$('#modal [data-k]').forEach((el) => {
      const k = el.dataset.k;
      const f = SCHEMA_FIELDS.get(k) || { k };

      if (el.dataset.cat) {
        const input = el.parentElement.querySelector('input[type=text]');
        const nova = input && !input.classList.contains('hidden') ? input.value.trim() : '';
        if (el.value === '__new__') {
          if (!nova) {
            if (!silent) toast('Digite o nome da nova categoria', 'err');
            invalid = true;
            return;
          }
          categoria = { id: '__new__', name: nova };
        } else if (el.value === '') {
          categoria = { id: '', name: '' };
        } else {
          const cat = categories.find((x) => String(x.id) === String(el.value) || x.name === el.value);
          categoria = { id: el.value, name: cat ? cat.name : el.value, color: cat && cat.color, sorter: cat && cat.sorter };
        }
        return;
      }

      let val;
      if (el.dataset.cdn) {
        const vals = [];
        $$('input[type=checkbox][data-cdn-val]', el).forEach((cb) => {
          if (cb.checked) vals.push(cb.dataset.cdnVal);
        });
        const extra = $('[data-cdn-extra]', el);
        if (extra) {
          extra.value.split('\n').map((s) => s.trim()).filter(Boolean)
            .forEach((s) => vals.push(normalizeEndpoint(s)));
        }
        val = [...new Set(vals)];
      } else if (el.dataset.json) {
        const raw = el.value.trim();
        if (!raw) {
          val = null;
        } else {
          try { val = JSON.parse(raw); } catch (_) {
            if (!silent) toast(`JSON inválido em ${f.l || k}`, 'err');
            invalid = true;
            return;
          }
        }
      } else if (el.type === 'checkbox') {
        val = el.checked;
      } else if (el.dataset.dns) {
        val = el.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      } else if (el.type === 'number') {
        val = el.value === '' ? 0 : Number(el.value);
      } else {
        val = el.value;
      }

      const paths = f.paths || (f.path ? [f.path] : []);
      if (paths.length) {
        let destino = paths[0];
        for (const p of paths) {
          if (getPath(target, p) !== undefined) { destino = p; break; }
        }
        for (const alt of (f.keys || [f.k])) {
          if (alt !== k && !destino.startsWith(alt + '.')) delete target[alt];
        }
        if (destino !== k && !paths.some((p) => p.startsWith(k + '.'))) delete target[k];
        setPath(target, destino, val);
      } else {
        for (const alt of (f.keys || [f.k])) {
          if (alt !== k) delete target[alt];
        }
        target[k] = val;
      }
    });

    if (invalid) return false;

    if (categoria) {
      if (!categoria.id) {
        delete target.category;
        target.category_id = 0;
      } else {
        const cat = target.category && typeof target.category === 'object' ? Object.assign({}, target.category) : {};
        if (categoria.id === '__new__') {
          cat.id = nextCategoryId();
          cat.name = categoria.name;
          cat.color = cat.color || '#5b8cff';
          cat.sorter = Number(cat.sorter) || (rows.length + 1);
        } else {
          const id = Number(categoria.id);
          cat.id = Number.isFinite(id) ? id : categoria.id;
          cat.name = categoria.name;
          cat.color = categoria.color || cat.color || '#5b8cff';
          cat.sorter = Number(categoria.sorter ?? cat.sorter) || 1;
        }
        target.category = cat;
        target.category_id = cat.id;
        delete target.category_name;
      }
    }

    return true;
  }

  async function saveEditor() {
    if (!collectForm(editorDraft)) return;
    if (editorIsNew) {
      editorDraft.id = nextConnectionId();
      rows.push(editorDraft);
      editIdx = rows.length - 1;
      editorIsNew = false;
    } else {
      rows[editIdx] = editorDraft;
    }
    dirty = true;
    render();
    const ok = await save();
    if (ok) closeEditor();
  }

  async function exportJson() {
    if (current === 'app_configs') {
      const id = editingThemeId || activeThemeId;
      if (!id) return toast('Não há tema para exportar.', 'err');
      return exportAppTheme(id);
    }
    if (current !== 'configs') { toast('A exportação é só da aba Conexões', 'err'); return; }
    try {
      const formato = confirm('OK = formato da API oficial do DTunnel (aninhado)\nCancelar = formato plano que o app usa') ? 'api' : 'app';
      const res = await fetch('/api/configs/export?formato=' + formato);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dtunnel-conexoes-${formato}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Exportado: ${data.length} conexões (${formato})`, 'ok');
    } catch (e) {
      toast('Erro ao exportar: ' + e.message, 'err');
    }
  }

  async function importJson(file) {
    try {
      const texto = await file.text();
      let payload = JSON.parse(texto);
      if (!Array.isArray(payload)) payload = payload.data || payload.configs || [];
      const r = await api('/api/configs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      toast(`Importado: ${r.count} conexões (formato ${r.formato}).`, 'ok');
      await load();
    } catch (e) {
      toast('Erro ao importar: ' + e.message, 'err');
    }
  }

  async function restore() {
    if (current === 'logs') return;
    if (!confirm('Restaurar o backup (.bak) do arquivo atual?')) return;
    try {
      const r = await api(`/api/${current}/restore`, { method: 'POST' });
      toast(`Restaurado: ${r.count} itens`, 'ok');
      load();
    } catch (e) {
      toast('Erro: ' + e.message, 'err');
    }
  }

  async function openPasswordModal() {
    $('#passError').classList.add('hidden');
    $('#passError').textContent = '';
    $('#passCurrent').value = '';
    $('#passNew').value = '';
    $('#passConfirm').value = '';
    $('#passModal').classList.remove('hidden');
    setTimeout(() => $('#passCurrent').focus(), 40);
    try {
      const s = await api('/api/auth/state');
      $('#passHint').textContent = s.custom
        ? 'Senha personalizada ativa. Informe a senha atual para trocá-la.'
        : 'O painel está usando a senha padrão do servidor. Defina uma senha própria.';
    } catch (_) {
      $('#passHint').textContent = 'Informe a senha atual para definir uma nova senha.';
    }
  }

  function closePasswordModal() {
    $('#passModal').classList.add('hidden');
  }

  async function savePassword() {
    const err = $('#passError');
    const atual = $('#passCurrent').value;
    const nova = $('#passNew').value;
    const conf = $('#passConfirm').value;
    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove('hidden');
    };
    if (!atual) return fail('Informe a senha atual.');
    if (nova.length < 4) return fail('A nova senha precisa ter pelo menos 4 caracteres.');
    if (nova !== conf) return fail('A confirmação não confere com a nova senha.');
    try {
      await api('/api/auth/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: atual, newPassword: nova }),
      });
      toast('Senha alterada com sucesso.', 'ok');
      closePasswordModal();
    } catch (e) {
      fail(e.message);
    }
  }

  function selectTab(file) {
    if (current === 'app_configs' && editingThemeId && (file !== 'app_configs' || file === current)) {
      if (dirty && !confirm('Descartar as alterações não salvas deste tema?')) return;
      editingThemeId = null;
      dirty = false;
    }
    if (file !== 'app_configs') editingThemeId = null;
    current = file;
    $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.file === file));
    $('#pageTitle').textContent = TITLES[file] || file;
    $('#pageSub').textContent = SUBTITLES[file] || '';
    $('#search').value = '';
    const isLogs = file === 'logs';
    const isBuild = file === 'build';
    const isReadonly = isLogs || isBuild;
    $('#search').disabled = isReadonly;
    const isConfigs = file === 'configs';
    const isThemes = file === 'app_configs';
    const isThemeList = isThemes && !editingThemeId;
    $('#export').classList.toggle('hidden', !(isConfigs || isThemes));
    $('#import').classList.toggle('hidden', !(isConfigs || isThemeList));
    $('#add').classList.toggle('hidden', isReadonly || (isThemes && !isThemeList));
    $('#add').textContent = isThemeList ? '+ Criar tema' : '+ Novo';
    $('#save').classList.toggle('hidden', isReadonly || isThemeList);
    $('#save').innerHTML = isThemes && editingThemeId ? 'Salvar tema' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg> Salvar';
    $('#restore').classList.toggle('hidden', isReadonly || isThemes);
    load();
  }

  async function loadSchema() {
    try {
      schema = await api('/api/config-schema');
      SCHEMA_FIELDS.clear();
      for (const m of Object.values(schema.modes || {})) {
        for (const [, fields] of m.groups) {
          for (const f of fields) SCHEMA_FIELDS.set(f.k, f);
        }
      }
    } catch (_) {
      schema = null;
    }
  }

  async function loadMeta() {
    const res = await Promise.allSettled([api('/api/categories'), api('/api/cdns')]);
    if (res[0].status === 'fulfilled') categories = res[0].value.data || [];
    if (res[1].status === 'fulfilled') cdns = res[1].value.data || [];
  }

  function closeSidebar() {
    const sb = $('#sidebar');
    const ov = $('#sidebarOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
  }

  function openSidebar() {
    const sb = $('#sidebar');
    const ov = $('#sidebarOverlay');
    if (sb) sb.classList.add('open');
    if (ov) ov.classList.add('show');
  }

  function bind() {
    $$('#tabs .tab').forEach((t) =>
      t.addEventListener('click', () => {
        selectTab(t.dataset.file);
        closeSidebar();
      })
    );

    const menuToggle = $('#menuToggle');
    if (menuToggle) menuToggle.addEventListener('click', openSidebar);
    const overlay = $('#sidebarOverlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);

    $('#save').addEventListener('click', save);
    const dirtySave = $('#dirtySave');
    if (dirtySave) dirtySave.addEventListener('click', save);
    $('#export').addEventListener('click', exportJson);
    $('#import').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) current === 'app_configs' ? importAppTheme(f) : importJson(f);
      ev.target.value = '';
    });
    $('#add').addEventListener('click', add);
    $('#reload').addEventListener('click', () => load());
    $('#restore').addEventListener('click', restore);
    $('#search').addEventListener('input', render);
    $('#changePass').addEventListener('click', openPasswordModal);
    $('#passClose').addEventListener('click', closePasswordModal);
    $('#passCancel').addEventListener('click', closePasswordModal);
    $('#passSave').addEventListener('click', savePassword);

    $('#modal').addEventListener('click', (ev) => {
      if (ev.target === $('#modal')) closeEditor();
    });
    $('#passModal').addEventListener('click', (ev) => {
      if (ev.target === $('#passModal')) closePasswordModal();
    });

    $('#editor').addEventListener('click', (ev) => {
      if (ev.target.closest('[data-theme-save]')) { save(); return; }
      if (ev.target.closest('[data-theme-build]')) { selectTab('build'); return; }
      if (ev.target.closest('[data-theme-new]')) { createAppTheme(); return; }
      if (ev.target.closest('[data-theme-back]')) {
        if (dirty && !confirm('Descartar as alterações não salvas deste tema?')) return;
        editingThemeId = null;
        dirty = false;
        updateAppThemeToolbar();
        load();
        return;
      }
      const themeButton = ev.target.closest('[data-theme-action]');
      if (themeButton) {
        const id = themeButton.dataset.themeId;
        const action = themeButton.dataset.themeAction;
        if (action === 'edit') editAppTheme(id);
        else if (action === 'preview') previewAppTheme(id);
        else if (action === 'html') editAppThemeHtml(id);
        else if (action === 'activate') activateAppTheme(id);
        else if (action === 'duplicate') createAppTheme(id);
        else if (action === 'rename') renameAppTheme(id);
        else if (action === 'export') exportAppTheme(id);
        else if (action === 'delete' && confirm('Excluir este tema? Essa ação não pode ser desfeita.')) {
          api(`/api/app-themes/${encodeURIComponent(id)}`, { method: 'DELETE' })
            .then(() => load())
            .then(() => toast('Tema excluído.', 'ok'))
            .catch((e) => toast('Erro ao excluir tema: ' + e.message, 'err'));
        }
        return;
      }
      const htmlAction = ev.target.closest('[data-html-action]');
      if (htmlAction) {
        const idx = Number(htmlAction.dataset.idx);
        const action = htmlAction.dataset.htmlAction;
        const card = htmlAction.closest('.app-config-option');
        const textarea = card && card.querySelector('textarea[data-key="value"]');
        if (action === 'edit') openHtmlConfig(idx, false);
        else if (action === 'preview') openHtmlConfig(idx, true);
        else if (action === 'import') card.querySelector(`[data-html-import="${idx}"]`).click();
        else if (action === 'clear' && textarea) { textarea.value = ''; textarea.dispatchEvent(new Event('input', { bubbles: true })); }
        return;
      }
      const edit = ev.target.closest('[data-edit]');
      if (edit) { openEditor(Number(edit.dataset.edit)); return; }
      const del = ev.target.closest('[data-del]');
      if (del) { deleteRow(Number(del.dataset.del)); return; }
      if (ev.target.closest('[data-new]')) { add(); return; }
      const head = ev.target.closest('.gen-head');
      if (head && !ev.target.closest('button')) {
        head.parentElement.classList.toggle('open');
      }
    });

    $('#editor').addEventListener('change', async (ev) => {
      const input = ev.target.closest('[data-html-import]');
      const file = input && input.files && input.files[0];
      if (!input || !file) return;
      const card = input.closest('.app-config-option');
      const textarea = card && card.querySelector('textarea[data-key="value"]');
      if (!textarea) return;
      textarea.value = await file.text();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = '';
      toast('HTML importado. Clique em Salvar para aplicar no app.', 'ok');
    });

    const onCell = (ev) => {
      const el = ev.target.closest('[data-key]');
      if (!el || !(el.closest('.gen-body') || el.closest('.app-fields'))) return;
      const card = el.closest('.card');
      const idx = Number(card && card.dataset.idx);
      if (!Number.isInteger(idx) || !rows[idx]) return;
      const key = el.dataset.key;
      let val;
      switch (el.dataset.kind) {
        case 'bool': val = el.checked; break;
        case 'number': val = el.value === '' ? 0 : Number(el.value); break;
        case 'select': {
          const previous = rows[idx][key];
          val = previous && typeof previous === 'object' && !Array.isArray(previous)
            ? { ...previous, selected: el.value }
            : el.value;
          break;
        }
        case 'json':
          try { val = JSON.parse(el.value); } catch (_) { return; }
          break;
        default: val = el.value;
      }
      rows[idx][key] = val;
      dirty = true;
      updateCount();
    };
    $('#editor').addEventListener('input', onCell);
    $('#editor').addEventListener('change', onCell);

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') {
        if (!$('#passModal').classList.contains('hidden')) closePasswordModal();
        else if ($('#htmlConfigModal')) $('#htmlConfigModal').remove();
        else if (!$('#modal').classList.contains('hidden')) closeEditor();
        else closeSidebar();
      }
      if (e.key === '/' && !typing && current !== 'logs') {
        e.preventDefault();
        $('#search').focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
  }

  async function boot() {
    bind();
    await Promise.all([loadSchema(), loadMeta()]);
    selectTab('configs');
    loadStatus();
    setInterval(loadStatus, 15000);
  }

  boot();
})();

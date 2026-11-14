'use strict';
/**
 * Painel web para editar os JSONs servidos pelo gRPC.
 * API REST + UI estatica.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const data = require('./data');
const appThemes = require('./app-themes');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PANEL_PASSWORD = process.env.DT_PANEL_PASSWORD || '';
const PORT = process.env.DT_PANEL_PORT || '8080';
const HOST = process.env.DT_PANEL_HOST || '0.0.0.0';
const AUTH_FILE = () => path.join(data.DATA_DIR, 'panel_auth.json');
const SESSION_COOKIE = 'dtpanel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function readPanelAuth() {
  try {
    const obj = JSON.parse(fs.readFileSync(AUTH_FILE(), 'utf8'));
    if (obj && obj.salt && obj.hash) return obj;
  } catch (_) {}
  return null;
}

function hashPanelPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPanelPassword(password) {
  const stored = readPanelAuth();
  if (!stored) return Boolean(PANEL_PASSWORD) && String(password) === PANEL_PASSWORD;
  try {
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = Buffer.from(hashPanelPassword(password, stored.salt), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function writePanelPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const payload = {
    algo: 'scrypt',
    salt,
    hash: hashPanelPassword(password, salt),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(AUTH_FILE(), JSON.stringify(payload, null, 1), { mode: 0o600 });
  return payload;
}

function parseBasic(header) {
  const raw = String(header || '');
  if (!raw.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hasValidSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function startPanel(opts = {}) {
  const app = express();
  const apkBuildJobs = new Map();
  let activeApkBuildId = null;
  let latestApkBuildId = null;
  const apkBuildView = (job) => ({
    id: job.id, status: job.status, host: job.host, port: job.port,
    log: job.log, error: job.error || null, startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    downloadUrl: job.status === 'done' ? `/api/build/${job.id}/download` : null,
  });
  app.use(express.json({ limit: '8mb' }));

  // --- autenticacao simples (Basic) ---
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (hasValidSession(req)) return next();
    const cred = parseBasic(req.headers.authorization);
    if (cred && cred.user === 'panel' && verifyPanelPassword(cred.pass)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="DTunnel Panel"');
    res.status(401).json({ error: 'nao autorizado' });
  });

  // arquivos estaticos (depois do auth)
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, dataDir: data.DATA_DIR });
  });

  app.get('/api/auth/state', (req, res) => {
    const stored = readPanelAuth();
    res.json({
      user: 'panel',
      custom: !!stored,
      updatedAt: stored ? stored.updatedAt || null : null,
    });
  });

  app.post('/api/auth/change', (req, res) => {
    const body = req.body || {};
    const atual = body.current;
    const nova = body.newPassword;
    if (!verifyPanelPassword(atual)) {
      return res.status(400).json({ error: 'senha atual incorreta' });
    }
    if (typeof nova !== 'string' || nova.length < 4) {
      return res.status(400).json({ error: 'a nova senha precisa ter pelo menos 4 caracteres' });
    }
    if (nova.length > 128) {
      return res.status(400).json({ error: 'a nova senha deve ter no maximo 128 caracteres' });
    }
    try {
      writePanelPassword(nova);
      const token = createSession();
      res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
      console.log('[panel] senha do painel alterada');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'nao foi possivel salvar a nova senha: ' + e.message });
    }
  });

  // exporta as conexoes em JSON (formato da API oficial do DTunnel)
  app.get('/api/configs/export', (req, res) => {
    try {
      const codec = require('./config-codec');
      const list = data.readJSON('configs');
      const formato = (req.query.formato || 'api').toLowerCase();
      if (formato === 'app') {
        // flat: converte os itens aninhados para o formato que o app le
        return res.json(codec.listFromApi(list));
      }
      res.json(codec.listToApi(list));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // importa conexoes de um JSON (formato da API oficial OU o plano do app)
  app.post('/api/configs/import', (req, res) => {
    try {
      const codec = require('./config-codec');
      let payload = req.body;
      if (payload && payload.data !== undefined) payload = payload.data;
      if (!Array.isArray(payload)) {
        return res.status(400).json({ error: 'envie uma lista JSON de conexoes' });
      }
      // detecta o formato: a API oficial tem server/proxy/dns_server aninhados
      const apiFmt = payload.some((c) => c && (c.server || c.proxy || c.dns_server || c.config_payload));
      const list = apiFmt ? codec.listFromApi(payload) : payload;
      const atual = data.readJSON('configs');
      const force = !!(req.body && req.body.force);
      let merged = list;
      if (!force) {
        // preserva as que ja existem pelo id e completa as novas
        merged = list.map((c) => {
          const antigo = atual.find((a) => a.id && c.id && a.id === c.id);
          return antigo ? Object.assign({}, antigo, c) : c;
        });
      }
      const normal = merged.map((c) => codec.normalize(c));
      const info = data.writeJSON('configs', normal);
      // sincroniza as categorias (o app agrupa as conexoes por category_id)
      const cats = codec.syncCategories(normal, data.readJSON('categories'));
      data.writeJSON('categories', cats);
      console.log(`[panel] ${merged.length} conexoes importadas (formato ${apiFmt ? 'api' : 'app'})`);
      res.json({ ok: true, count: merged.length, formato: apiFmt ? 'api' : 'app', ...info });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // schema de edicao das conexoes (campos por modo de conexao)
  app.get('/api/config-schema', (req, res) => {
    res.json(require('./config-schema').schema());
  });

  app.get('/api/files', (req, res) => {
    res.json(data.listAll());
  });

  // log do servidor gRPC
  app.get('/api/logs', (req, res) => {
    const logFile = process.env.DT_LOG_FILE || '/tmp/srv_remote.log';
    try {
      const lines = fs.readFileSync(logFile, 'utf8').split('\n');
      const n = Math.min(parseInt(req.query.n, 10) || 200, 2000);
      res.json({ file: logFile, lines: lines.slice(-n) });
    } catch (e) {
      res.json({ file: logFile, lines: [], error: e.message });
    }
  });

  // status geral
  app.get('/api/status', (req, res) => {
    const out = { dataDir: data.DATA_DIR, files: data.listAll(), panelPort: Number(PORT) };
    try {
      const { execSync } = require('child_process');
      const grpcPort = String(process.env.GRPC_PORT || '443');
      out.grpcPort = Number(grpcPort) || 443;
      out.grpc = execSync(`ss -tln 2>/dev/null | grep -E ':${grpcPort}( |$)' || true`).toString().trim();
    } catch (_) {}
    res.json(out);
  });

  // info para build do APK (sem chaves privadas)
  app.get('/api/build-info', (req, res) => {
    const keysDir = data.SERVER_DIR || path.join(path.resolve(__dirname, '..'), 'keys');
    const grpcPort = Number(process.env.GRPC_PORT || process.env.DT_GRPC_PORT || 8443) || 8443;
    const hostHint = String(process.env.DT_PUBLIC_HOST || '151.244.242.211').trim();
    const files = {
      caPem: fs.existsSync(path.join(keysDir, 'ca.pem')),
      serverPem: fs.existsSync(path.join(keysDir, 'server.pem')),
      replyPub: fs.existsSync(path.join(keysDir, 'server_reply_key.json')),
      replyPriv: fs.existsSync(path.join(keysDir, 'server_reply.key')),
    };
    const builderDir = path.resolve(process.env.DT_APK_BUILDER_DIR || '/root/apk-build/dtunnel-mod');
    const apkOriginal = path.resolve(process.env.DT_APK_ORIG || path.join(builderDir, 'apk/DTunnel_5.0.0.apk'));
    const signingKey = path.resolve(process.env.DT_APK_SIGNING_KEY || path.join(builderDir, 'patch/dt2.jks'));
    const builderReady = [
      path.join(builderDir, 'make_mod.sh'), apkOriginal,
      path.join(builderDir, 'patch/build_apk.py'), signingKey,
    ].every((file) => fs.existsSync(file)) && !!process.env.DT_APK_SIGNING_KEY_PASS;
    let replyPubPreview = null;
    try {
      if (files.replyPub) {
        const j = JSON.parse(fs.readFileSync(path.join(keysDir, 'server_reply_key.json'), 'utf8'));
        replyPubPreview = typeof j === 'string' ? j.slice(0, 24) + '…' : (j.publicKey || j.spki || '').toString().slice(0, 24) + '…';
      }
    } catch (_) {}
    res.json({
      host: hostHint,
      grpcPort,
      panelPort: Number(PORT),
      tls: process.env.DT_TLS !== '0',
      keysDir,
      files,
      replyPubPreview,
      ready: files.caPem && files.replyPub,
      builderReady,
      commands: {
        sync: `./sync_keys.sh ${hostHint || 'SEU_IP'} root`,
        build: `./make_mod.sh ${hostHint || 'SEU_IP'} ${grpcPort}`,
        install: 'adb install -r dist/dt_patched_signed.apk',
      },
    });
  });

  // Compila o APK na VPS. A rota usa caminho fixo, host validado e nunca envia chaves privadas ao cliente.
  app.post('/api/build', (req, res) => {
    const origin = req.headers.origin;
    const requestHost = String(req.headers.host || '').toLowerCase();
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'origem de build não permitida' });
    }
    if (origin) {
      try {
        if (new URL(origin).host.toLowerCase() !== requestHost) {
          return res.status(403).json({ error: 'origem de build não permitida' });
        }
      } catch (_) {
        return res.status(403).json({ error: 'origem de build inválida' });
      }
    }
    if (activeApkBuildId) {
      return res.status(409).json({ error: 'já existe uma compilação APK em andamento' });
    }

    const host = String(process.env.DT_PUBLIC_HOST || '151.244.242.211').trim();
    const grpcPort = Number(process.env.GRPC_PORT || process.env.DT_GRPC_PORT || 8443);
    const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
    const net = require('net');
    const looksNumericIp = /^[0-9.]+$/.test(host);
    const octets = net.isIP(host) === 4 ? host.split('.').map(Number) : [];
    const privateIp = octets.length === 4 && (
      octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    );
    if (!host || /SEU_IP|DOMINIO|localhost|0\.0\.0\.0/i.test(host) ||
        (looksNumericIp ? net.isIP(host) !== 4 || privateIp : !hostnamePattern.test(host))) {
      return res.status(400).json({ error: 'configure um IP público ou domínio válido em DT_PUBLIC_HOST' });
    }
    if (!Number.isInteger(grpcPort) || grpcPort < 1 || grpcPort > 65535) {
      return res.status(400).json({ error: 'porta gRPC inválida' });
    }

    const builderDir = path.resolve(process.env.DT_APK_BUILDER_DIR || '/root/apk-build/dtunnel-mod');
    const scriptPath = path.join(builderDir, 'make_mod.sh');
    const apkOriginal = path.resolve(process.env.DT_APK_ORIG || path.join(builderDir, 'apk/DTunnel_5.0.0.apk'));
    const signingKey = path.resolve(process.env.DT_APK_SIGNING_KEY || path.join(builderDir, 'patch/dt2.jks'));
    const signingPass = process.env.DT_APK_SIGNING_KEY_PASS || '';
    const keysDir = data.SERVER_DIR || path.join(path.resolve(__dirname, '..'), 'keys');
    const caFile = path.join(keysDir, 'ca.pem');
    const replyPublicFile = path.join(keysDir, 'server_reply_key.json');
    const required = [
      scriptPath,
      apkOriginal,
      path.join(builderDir, 'patch', 'build_apk.py'),
      signingKey,
      caFile,
      replyPublicFile,
    ];
    const missing = required.find((file) => !fs.existsSync(file));
    if (missing) {
      return res.status(503).json({ error: `arquivo necessário ausente: ${path.basename(missing)}` });
    }
    if (!signingPass) {
      return res.status(503).json({ error: 'configure DT_APK_SIGNING_KEY_PASS no ambiente do Node; não grave a senha no repositório' });
    }
    try {
      fs.accessSync(scriptPath, fs.constants.X_OK);
    } catch (_) {
      return res.status(503).json({ error: 'make_mod.sh não tem permissão de execução' });
    }

    const jobId = crypto.randomBytes(12).toString('hex');
    const temporaryKeysDir = path.join('/tmp', `dtunnel-apk-keys-${jobId}`);
    const builderOutputDir = path.resolve(process.env.DT_APK_OUT_DIR || path.join(builderDir, '..', 'out'));
    if (builderOutputDir === PUBLIC_DIR || builderOutputDir.startsWith(PUBLIC_DIR + path.sep)) {
      return res.status(400).json({ error: 'o diretório de saída do APK não pode ser público' });
    }
    const safeHost = host.replace(/[^a-z0-9.-]/gi, '_');
    const outputFile = path.join(builderOutputDir, `dtunnel-${safeHost}-${grpcPort}-${Date.now()}-${jobId.slice(0, 6)}.apk`);
    let child;
    let job;
    try {
      fs.mkdirSync(temporaryKeysDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(caFile, path.join(temporaryKeysDir, 'ca.pem'));
      fs.copyFileSync(replyPublicFile, path.join(temporaryKeysDir, 'server_reply_key.json'));
      fs.mkdirSync(builderOutputDir, { recursive: true });

      job = {
        id: jobId, status: 'running', host, port: grpcPort, log: '', error: null,
        outputFile, tempDir: temporaryKeysDir, startedAt: new Date().toISOString(),
      };
      apkBuildJobs.set(jobId, job);
      activeApkBuildId = jobId;
      latestApkBuildId = jobId;

      const home = process.env.HOME || '/root';
      const childEnv = {
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: home,
        LANG: process.env.LANG || 'C.UTF-8',
        OUT: outputFile,
        KEYS: temporaryKeysDir,
        APK_ORIG: apkOriginal,
        APK_KEYSTORE: signingKey,
        APK_KEYSTORE_PASS: signingPass,
        APK_KEY_ALIAS: process.env.DT_APK_SIGNING_KEY_ALIAS || 'dt',
      };
      for (const key of ['ANDROID_SDK_ROOT', 'ANDROID_HOME', 'JAVA_HOME', 'APKTOOL', 'TLS_MODE']) {
        if (process.env[key]) childEnv[key] = process.env[key];
      }
      const sdkCandidates = [
        childEnv.ANDROID_SDK_ROOT, childEnv.ANDROID_HOME,
        path.join(home, 'Android', 'Sdk'), path.join(home, 'android-sdk'),
        '/usr/lib/android-sdk', '/opt/android-sdk',
      ].filter(Boolean);
      const sdkRoot = sdkCandidates.find((dir) => fs.existsSync(path.join(dir, 'build-tools')));
      if (sdkRoot) {
        childEnv.ANDROID_SDK_ROOT = sdkRoot;
        childEnv.ANDROID_HOME = sdkRoot;
      }

      const { spawn } = require('child_process');
      child = spawn(scriptPath, [host, String(grpcPort)], {
        cwd: builderDir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      const appendLog = (chunk) => {
        job.log = (job.log + chunk.toString()).slice(-200000);
      };
      child.stdout.on('data', appendLog);
      child.stderr.on('data', appendLog);

      let finalized = false;
      const finalize = (code, signal, spawnError) => {
        if (finalized) return;
        finalized = true;
        clearTimeout(job.timeout);
        clearTimeout(job.killTimeout);
        if (spawnError) job.error = `não foi possível iniciar make_mod.sh: ${spawnError.message}`;
        if (!job.error && code !== 0) job.error = `make_mod.sh terminou com código ${code}${signal ? ` (${signal})` : ''}`;
        if (!job.error) {
          try {
            if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size < 1024) {
              job.error = 'o build terminou sem gerar um APK válido';
            }
          } catch (_) {
            job.error = 'não foi possível verificar o APK gerado';
          }
        }
        job.status = job.error ? 'failed' : 'done';
        job.finishedAt = new Date().toISOString();
        if (activeApkBuildId === jobId) activeApkBuildId = null;
        try { fs.rmSync(temporaryKeysDir, { recursive: true, force: true }); } catch (_) {}
        console.log(`[panel] build APK ${job.status} para ${host}:${grpcPort} (job ${jobId})`);
      };
      child.on('error', (error) => finalize(null, null, error));
      child.on('close', (code, signal) => finalize(code, signal, null));
      job.timeout = setTimeout(() => {
        if (job.status !== 'running') return;
        job.error = 'compilação excedeu o limite de 30 minutos';
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
        job.killTimeout = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
        }, 5000);
        job.killTimeout.unref();
      }, 30 * 60 * 1000);
      job.timeout.unref();

      res.status(202).json({ id: jobId, status: 'running' });
    } catch (e) {
      if (child) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
      }
      if (job) {
        job.status = 'failed';
        job.error = e.message;
        job.finishedAt = new Date().toISOString();
      }
      if (activeApkBuildId === jobId) activeApkBuildId = null;
      try { fs.rmSync(temporaryKeysDir, { recursive: true, force: true }); } catch (_) {}
      res.status(500).json({ error: `falha ao preparar a compilação: ${e.message}` });
    }
  });

  app.get('/api/build/current', (req, res) => {
    const job = latestApkBuildId && apkBuildJobs.get(latestApkBuildId);
    res.json({ job: job ? apkBuildView(job) : null });
  });

  app.get('/api/build/:id/download', (req, res) => {
    const job = apkBuildJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'build não encontrado nesta sessão do painel' });
    if (job.status !== 'done' || !fs.existsSync(job.outputFile)) {
      return res.status(409).json({ error: 'o APK ainda não está disponível' });
    }
    res.download(job.outputFile, path.basename(job.outputFile), (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'não foi possível enviar o APK' });
    });
  });

  app.get('/api/build/:id', (req, res) => {
    const job = apkBuildJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'build não encontrado nesta sessão do painel' });
    res.json(apkBuildView(job));
  });

  // download apenas de materiais públicos (CA + chave pública de reply)
  app.get('/api/build-keys/:name', (req, res) => {
    const allowed = {
      'ca.pem': 'ca.pem',
      'server_reply_key.json': 'server_reply_key.json',
    };
    const name = allowed[req.params.name];
    if (!name) return res.status(400).json({ error: 'arquivo nao permitido' });
    const keysDir = data.SERVER_DIR || path.join(path.resolve(__dirname, '..'), 'keys');
    const file = path.join(keysDir, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'arquivo ausente no servidor' });
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (name.endsWith('.json')) res.type('application/json');
    else res.type('application/x-pem-file');
    fs.createReadStream(file).pipe(res);
  });


  // Perfis de tema do aplicativo; o gRPC continua lendo app_configs.json,
  // que é atualizado atomicamente pelo fluxo de ativação do perfil.
  app.get('/api/app-themes', (req, res) => {
    try { res.json(appThemes.list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/app-themes', (req, res) => {
    try { res.status(201).json(appThemes.create(req.body || {})); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/app-themes/import', (req, res) => {
    try { res.status(201).json(appThemes.importTheme(req.body || {})); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/app-themes/:id/export', (req, res) => {
    try {
      const theme = appThemes.get(req.params.id);
      res.setHeader('Content-Disposition', `attachment; filename="dtunnel-tema-${theme.id}.json"`);
      res.json({ name: theme.name, appConfigs: theme.appConfigs });
    } catch (e) { res.status(404).json({ error: e.message }); }
  });
  app.get('/api/app-themes/:id', (req, res) => {
    try { res.json(appThemes.get(req.params.id)); }
    catch (e) { res.status(404).json({ error: e.message }); }
  });
  app.put('/api/app-themes/:id', (req, res) => {
    try { res.json(appThemes.update(req.params.id, req.body || {})); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/app-themes/:id/activate', (req, res) => {
    try { res.json(appThemes.activate(req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/app-themes/:id', (req, res) => {
    try { res.json(appThemes.remove(req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/:key', (req, res) => {
    try {
      res.json({ key: req.params.key, data: data.readJSON(req.params.key) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/:key', (req, res) => {
    const { key } = req.params;
    try {
      if (!data.FILES[key]) return res.status(400).json({ error: 'arquivo desconhecido' });
      const body = req.body;
      const payload = body && body.data !== undefined ? body.data : body;
      if (!Array.isArray(payload)) {
        return res.status(400).json({ error: 'o arquivo precisa ser uma lista JSON (array)' });
      }
      // protecao: nao aceita array vazio (evita apagar tudo por engano)
      if (payload.length === 0) {
        const current = data.readJSON(key);
        if (Array.isArray(current) && current.length > 0) {
          return res.status(400).json({
            error: `recusado: o arquivo tem ${current.length} itens. Envie "force": true para limpar de verdade.`,
          });
        }
      }
      const force = !!(body && body.force);
      // configs sempre no formato da API oficial (aninhado), como no painel original
      const toSave = key === 'configs'
        ? payload.map((c) => require('./config-codec').normalize(c))
        : payload;
      const info = data.writeJSON(key, toSave);
      if (key === 'app_configs') appThemes.syncActive(toSave);
      // as categorias das conexoes precisam existir, senao o app nao mostra
      // nenhuma config (ele agrupa por category_id)
      if (key === 'configs' && Array.isArray(toSave)) {
        const codec = require('./config-codec');
        const cats = codec.syncCategories(toSave, data.readJSON('categories'));
        data.writeJSON('categories', cats);
      }
      console.log(`[panel] ${key} salvo (${payload.length} itens, ${info.bytes} bytes)`);
      res.json({ ok: true, ...info, count: payload.length, force });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // restaura a ultima versao (.bak)
  app.post('/api/:key/restore', (req, res) => {
    const { key } = req.params;
    try {
      const p = data.filePath(key);
      const bak = p + '.bak';
      if (!fs.existsSync(bak)) return res.status(400).json({ error: 'sem backup disponivel' });
      const content = fs.readFileSync(bak, 'utf8');
      const restored = JSON.parse(content); // valida
      fs.writeFileSync(p, content, 'utf8');
      if (key === 'app_configs') appThemes.syncActive(restored);
      const n = restored.length;
      console.log(`[panel] ${key} restaurado do backup (${n} itens)`);
      res.json({ ok: true, count: n });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // busca em qualquer campo
  app.post('/api/:key/search', (req, res) => {
    try {
      const rows = data.readJSON(req.params.key);
      const q = String((req.body && req.body.q) || '').toLowerCase();
      if (!q) return res.json({ results: rows });
      const results = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      res.json({ results });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(PORT, HOST, () => {
      const senha = readPanelAuth() ? 'configurada no painel' : (PANEL_PASSWORD ? 'configurada pelo ambiente' : 'não configurada');
      console.log(`[panel] painel web em http://${HOST}:${PORT} (user: panel / senha ${senha})`);
      resolve(server);
    });
  });
}

module.exports = { startPanel, PANEL_PASSWORD, PORT };

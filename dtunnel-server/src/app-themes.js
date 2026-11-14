'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const data = require('./data');

const STORE_PATH = path.join(data.DATA_DIR, 'app_themes.json');
const STORE_BACKUP = `${STORE_PATH}.bak`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function validateSettings(settings) {
  if (!Array.isArray(settings) || settings.length > 10000) {
    throw new Error('As configurações do tema precisam ser uma lista JSON válida.');
  }
  for (const [index, item] of settings.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.name !== 'string') {
      throw new Error(`Configuração inválida na posição ${index}.`);
    }
  }
  return clone(settings);
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    const now = new Date().toISOString();
    const initial = {
      version: 1,
      activeId: newId(),
      themes: [{
        id: null,
        name: 'Tema padrão',
        createdAt: now,
        updatedAt: now,
        appConfigs: validateSettings(data.readJSON('app_configs')),
      }],
    };
    initial.themes[0].id = initial.activeId;
    writeStore(initial, false);
    return initial;
  }
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  if (!store || store.version !== 1 || !Array.isArray(store.themes) || !store.themes.length) {
    throw new Error('O arquivo de temas está inválido; nenhum tema foi alterado.');
  }
  store.themes.forEach((theme) => {
    if (!theme || typeof theme.id !== 'string' || !Array.isArray(theme.appConfigs)) {
      throw new Error('O arquivo de temas contém um perfil inválido.');
    }
    validateSettings(theme.appConfigs);
  });
  if (!store.themes.some((theme) => theme.id === store.activeId)) {
    throw new Error('O tema ativo não existe no armazenamento de temas.');
  }
  return store;
}

function writeStore(store, backup = true) {
  fs.mkdirSync(data.DATA_DIR, { recursive: true });
  if (backup && fs.existsSync(STORE_PATH)) {
    fs.copyFileSync(STORE_PATH, STORE_BACKUP);
  }
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(temp, STORE_PATH);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function summarize(theme, activeId) {
  const wanted = new Set([
    'APP_LOGO', 'APP_BACKGROUND_TYPE', 'APP_BACKGROUND_COLOR', 'APP_BACKGROUND_IMAGE',
    'APP_NATIVE_BACKGROUND_COLOR', 'APP_NATIVE_BACKGROUND_GRADIENT_START_COLOR',
    'APP_NATIVE_BACKGROUND_GRADIENT_CENTER_COLOR', 'APP_NATIVE_BACKGROUND_GRADIENT_END_COLOR',
    'APP_NATIVE_CARD_COLOR', 'APP_NATIVE_STATUS_CARD_COLOR', 'APP_NATIVE_BUTTON_COLOR',
    'APP_NATIVE_TEXT_COLOR', 'APP_NATIVE_ICON_COLOR', 'APP_LAYOUT_WEBVIEW_ENABLED',
    'APP_LAYOUT_WEBVIEW', 'APP_WEB_HOME_CONTENT', 'APP_WEB_PAGE_CONTENT', 'APP_WEB_VIEW',
  ]);
  const preview = {};
  for (const item of theme.appConfigs) {
    const name = String(item.name || '').toUpperCase();
    if (wanted.has(name)) {
      const value = item.value;
      preview[name] = value;
    }
  }
  return {
    id: theme.id,
    name: theme.name,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
    active: theme.id === activeId,
    preview,
  };
}

function list() {
  const store = readStore();
  return { activeId: store.activeId, themes: store.themes.map((theme) => summarize(theme, store.activeId)) };
}

function get(id) {
  const store = readStore();
  const theme = store.themes.find((entry) => entry.id === id);
  if (!theme) throw new Error('Tema não encontrado.');
  return { ...summarize(theme, store.activeId), appConfigs: clone(theme.appConfigs) };
}

function create(input = {}) {
  const store = readStore();
  if (store.themes.length >= 50) throw new Error('Limite de 50 temas atingido. Exclua um tema antes de criar outro.');
  const sourceId = input.sourceId || store.activeId;
  const source = store.themes.find((theme) => theme.id === sourceId);
  if (!source) throw new Error('Tema de origem não encontrado.');
  const now = new Date().toISOString();
  const theme = {
    id: newId(),
    name: String(input.name || 'Novo tema').trim().slice(0, 80) || 'Novo tema',
    createdAt: now,
    updatedAt: now,
    appConfigs: validateSettings(source.appConfigs),
  };
  store.themes.push(theme);
  writeStore(store);
  return summarize(theme, store.activeId);
}

function update(id, input = {}) {
  const store = readStore();
  const theme = store.themes.find((entry) => entry.id === id);
  if (!theme) throw new Error('Tema não encontrado.');
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 80) throw new Error('O nome do tema deve ter de 1 a 80 caracteres.');
    theme.name = name;
  }
  if (input.appConfigs !== undefined) theme.appConfigs = validateSettings(input.appConfigs);
  theme.updatedAt = new Date().toISOString();
  const isActiveUpdate = theme.id === store.activeId && input.appConfigs !== undefined;
  const previous = isActiveUpdate ? data.readJSON('app_configs') : null;
  try {
    if (isActiveUpdate) data.writeJSON('app_configs', theme.appConfigs);
    writeStore(store);
  } catch (error) {
    if (isActiveUpdate && previous) {
      try { fs.writeFileSync(data.filePath('app_configs'), JSON.stringify(previous, null, 1), 'utf8'); } catch (_) {}
    }
    throw error;
  }
  return summarize(theme, store.activeId);
}

function activate(id) {
  const store = readStore();
  const theme = store.themes.find((entry) => entry.id === id);
  if (!theme) throw new Error('Tema não encontrado.');
  const previous = data.readJSON('app_configs');
  try {
    data.writeJSON('app_configs', validateSettings(theme.appConfigs));
    store.activeId = theme.id;
    theme.updatedAt = new Date().toISOString();
    writeStore(store);
  } catch (error) {
    // Roll back the active file if persisting theme metadata fails.
    try { fs.writeFileSync(data.filePath('app_configs'), JSON.stringify(previous, null, 1), 'utf8'); } catch (_) {}
    throw error;
  }
  return list();
}

function remove(id) {
  const store = readStore();
  if (id === store.activeId) throw new Error('Não é possível excluir o tema ativo. Ative outro tema primeiro.');
  const index = store.themes.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error('Tema não encontrado.');
  const [removed] = store.themes.splice(index, 1);
  writeStore(store);
  return { ok: true, id: removed.id };
}

function importTheme(input = {}) {
  const settings = input.appConfigs || input.app_config || input.settings;
  if (!Array.isArray(settings)) throw new Error('O arquivo importado não contém uma lista appConfigs válida.');
  const store = readStore();
  if (store.themes.length >= 50) throw new Error('Limite de 50 temas atingido. Exclua um tema antes de importar outro.');
  const name = String(input.name || 'Tema importado').trim().slice(0, 80) || 'Tema importado';
  const now = new Date().toISOString();
  const theme = { id: newId(), name, createdAt: now, updatedAt: now, appConfigs: validateSettings(settings) };
  store.themes.push(theme);
  writeStore(store);
  return summarize(theme, store.activeId);
}

function syncActive(settings) {
  const store = readStore();
  const active = store.themes.find((theme) => theme.id === store.activeId);
  if (!active) throw new Error('Tema ativo não encontrado.');
  active.appConfigs = validateSettings(settings);
  active.updatedAt = new Date().toISOString();
  writeStore(store);
}

module.exports = { list, get, create, update, activate, remove, importTheme, syncActive };

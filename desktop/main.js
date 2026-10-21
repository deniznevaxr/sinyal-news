// SİNYAL for Windows: a small Electron shell that opens the published site in its own
// window. News and the interface itself come from the web, so the installed app never
// needs updating; this file only manages the window, links and an offline first start.
import { app, BrowserWindow, Menu, clipboard, ipcMain, nativeTheme, screen, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.SINYAL_URL || 'https://deniznevaxr.github.io/sinyal-news/';
const HOME = new URL(APP_URL);
const THEMES = new Set(['dark', 'light', 'system']);
const BG = { dark: '#0c0d10', light: '#eef0f2' };
const PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);

const inApp = url => {
  try {
    const u = new URL(url);
    return u.origin === HOME.origin && u.pathname.startsWith(HOME.pathname);
  } catch {
    return false;
  }
};
const isWeb = url => /^https?:\/\//i.test(url);
const openOutside = url => { if (isWeb(url)) shell.openExternal(url); };

// ------------------------------------------------------------------ remembered window
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { /* first start */ }

function saveState(win) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...state, bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch { /* not worth failing over */ }
}

// The saved size and place while they still fit a connected screen; otherwise a centred window.
function initialBounds() {
  const work = screen.getPrimaryDisplay().workArea;
  const size = { width: Math.min(1440, work.width - 40), height: Math.min(920, work.height - 40) };
  const b = state.bounds;
  if (!b) return size;
  const a = screen.getDisplayMatching(b).workArea;
  const onScreen = b.x < a.x + a.width - 120 && b.x + b.width > a.x + 120 && b.y >= a.y - 8 && b.y < a.y + a.height - 60;
  return onScreen
    ? { x: b.x, y: b.y, width: Math.min(b.width, a.width), height: Math.min(b.height, a.height) }
    : { width: Math.min(b.width, size.width), height: Math.min(b.height, size.height) };
}

// The page reports its theme setting; the native title bar (and the page's
// prefers-color-scheme) follow it.
function applyTheme(theme) {
  state.theme = THEMES.has(theme) ? theme : 'dark';
  nativeTheme.themeSource = state.theme;
}
const background = () => (nativeTheme.shouldUseDarkColors ? BG.dark : BG.light);

// ------------------------------------------------------------------ the window
function createWindow() {
  applyTheme(state.theme);
  const win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 380,
    minHeight: 560,
    title: 'SİNYAL',
    icon: path.join(HERE, 'build', 'icon.ico'),
    backgroundColor: background(),
    show: false,
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), sandbox: true, contextIsolation: true, spellcheck: false },
  });
  const wc = win.webContents;

  const reveal = () => {
    if (win.isDestroyed() || win.isVisible()) return;
    if (state.maximized) win.maximize();
    else win.show();
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 2500); // a slow connection should not look like the app failed to start
  win.on('page-title-updated', e => e.preventDefault());
  win.on('close', () => saveState(win));

  // Articles, videos and repos open in the regular browser; the window stays on SİNYAL.
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (inApp(url)) return;
    e.preventDefault();
    openOutside(url);
  });

  // No connection on the very first start (later starts are served from the page's own cache).
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !inApp(url)) return; // -3: replaced by a newer navigation
    win.loadFile(path.join(HERE, 'offline.html'), { query: { u: APP_URL } }).catch(() => {});
  });

  wc.on('did-finish-load', () => wc.setZoomLevel(state.zoom || 0));
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const setZoom = level => {
      e.preventDefault();
      wc.setZoomLevel(Math.max(-3, Math.min(4, level)));
      state.zoom = wc.getZoomLevel();
    };
    if (key === 'f5' || (ctrl && key === 'r')) { e.preventDefault(); wc.reload(); }
    else if (key === 'f11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (ctrl && (key === '+' || key === '=' || input.code === 'NumpadAdd')) setZoom(wc.getZoomLevel() + 0.5);
    else if (ctrl && (key === '-' || input.code === 'NumpadSubtract')) setZoom(wc.getZoomLevel() - 0.5);
    else if (ctrl && (key === '0' || input.code === 'Numpad0')) setZoom(0);
  });

  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (isWeb(p.linkURL) && !inApp(p.linkURL)) {
      items.push(
        { label: 'Bağlantıyı tarayıcıda aç', click: () => shell.openExternal(p.linkURL) },
        { label: 'Bağlantı adresini kopyala', click: () => clipboard.writeText(p.linkURL) },
      );
    }
    if (p.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { role: 'cut', label: 'Kes', enabled: p.editFlags.canCut },
        { role: 'copy', label: 'Kopyala', enabled: p.editFlags.canCopy },
        { role: 'paste', label: 'Yapıştır', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: 'Tümünü seç' },
      );
    } else if (p.selectionText.trim()) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ role: 'copy', label: 'Kopyala' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.loadURL(APP_URL).catch(() => {}); // failures are handled by did-fail-load
  return win;
}

// ------------------------------------------------------------------ app lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit(); // already open: the running copy comes to the front instead
} else {
  let win = null;
  app.setAppUserModelId('com.nevaxr.sinyal'); // ties notifications to the Start menu shortcut

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  ipcMain.on('sinyal:theme', (e, theme) => {
    if (!win || e.sender !== win.webContents) return;
    applyTheme(theme);
    win.setBackgroundColor(background());
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(PERMISSIONS.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => PERMISSIONS.has(permission));
    win = createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

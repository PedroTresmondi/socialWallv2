export const CONFIG_KEY = 'socialWallConfig_v27';
export const GRID_STATE_KEY = 'socialWallGridState_v27';
export const HIDDEN_IMAGES_KEY = 'socialWallHidden_v27';

export const API_BASE_URL = 'http://localhost:3000/api/images';
export const UPLOAD_URL = 'http://localhost:3000/api/upload';
export const STATE_SYNC_URL = 'http://localhost:3000/api/state';

export const syncChannel = new BroadcastChannel('social_wall_sync_channel_v27');

export const defaultConfig = {
    // Metadados do Evento / Tela
    eventName: '',
    screenWidth: 1920,
    screenHeight: 1080,

    // Layout
    layoutMode: 'target',
    targetCount: 20,
    cols: 5, rows: 4,
    photoWidth: 300, photoHeight: 300,
    gap: 10,

    // Aparência
    opacity: 1,
    backgroundUrl: '',
    bgBrightness: 100, // %
    bgContrast: 100,    // %
    bgSaturate: 100,    // %
    bgBlur: 0,          // px

    // Branding
    logoUrl: '', logoPosition: 'top-right',
    tickerText: '', tickerEnabled: false,

    // Comportamento
    randomPosition: true,
    animType: 'pop', animDuration: 600,
    showGridNumber: false,          // 🔢 mostrar número do slot no telão

    entryAnimation: true,   // Liga/Desliga
    entryDuration: 3000,    // Tempo total destacada (ms)
    entryAnimSpeed: 500,    // Velocidade da transição (ms)
    entryScale: 1.5,
    // Modos
    heroEnabled: false, heroInterval: 10,
    idleEnabled: false, idleTimeout: 30,
    processing: true,
    processInterval: 3000,
    persistGrid: true, removalMode: false,

    // Fonte
    sourceMode: 'local',
    dropboxToken: '', dropboxFolder: '/',

    // Exportação
    exportEnabled: false,
    exportWidth: 300,
    exportHeight: 300,
    exportWithBackground: true,
    exportBaseFolder: 'exports',
    overlayStrength: 100
};

export function computeGridFromTarget(target, aspectRatio = 16 / 9) {
    const t = Math.max(1, Math.floor(target || 1));
    const ar = aspectRatio > 0 ? aspectRatio : 16 / 9;

    let best = null;

    for (let rows = 1; rows <= t; rows++) {
        const cols = Math.ceil(t / rows);
        const cells = rows * cols;
        const gridRatio = cols / rows;
        const ratioDiff = Math.abs(gridRatio - ar);
        const leftover = cells - t;

        const score = leftover * 10 + ratioDiff;

        if (!best || score < best.score) {
            best = { rows, cols, cells, leftover, score };
        }
    }

    if (!best) {
        return { rows: 1, cols: t, cells: t, leftover: 0 };
    }

    return {
        rows: best.rows,
        cols: best.cols,
        cells: best.cells,
        leftover: best.leftover
    };
}

// --- helpers de estado para backup ---

function getStateSnapshot() {
    let config = defaultConfig;
    try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) config = { ...defaultConfig, ...JSON.parse(saved) };
    } catch (e) { }

    let gridState = [];
    try {
        gridState = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    } catch (e) { }

    let hiddenImages = [];
    try {
        hiddenImages = JSON.parse(localStorage.getItem(HIDDEN_IMAGES_KEY) || '[]');
    } catch (e) { }

    return { config, gridState, hiddenImages };
}

let syncTimer = null;

// dispara um POST /api/state com debounce
export function scheduleStateSync() {
    try {
        // se não tiver fetch (ambiente estranhão), só ignora
        if (typeof fetch !== 'function') return;
    } catch {
        return;
    }

    if (syncTimer) clearTimeout(syncTimer);

    syncTimer = setTimeout(() => {
        syncTimer = null;
        const snapshot = getStateSnapshot();
        fetch(STATE_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot)
        }).catch(() => {
            // em evento, se o servidor cair, não queremos quebrar o front
            console.warn('[StateSync] Falha ao sincronizar estado com servidor.');
        });
    }, 500); // 0.5s de debounce pra não spammar durante sliders
}

// chamado no boot do admin/wall
export async function restoreStateFromServer() {
    try {
        // Se já existir alguma coisa local, não sobrescreve
        const hasLocalConfig = !!localStorage.getItem(CONFIG_KEY);
        const hasGrid = !!localStorage.getItem(GRID_STATE_KEY);
        const hasHidden = !!localStorage.getItem(HIDDEN_IMAGES_KEY);

        if (hasLocalConfig || hasGrid || hasHidden) return;

        const res = await fetch(STATE_SYNC_URL);
        if (!res.ok) return;

        const data = await res.json();
        const { config, gridState, hiddenImages } = data || {};

        if (config) {
            localStorage.setItem(
                CONFIG_KEY,
                JSON.stringify({ ...defaultConfig, ...config })
            );
        }
        if (Array.isArray(gridState)) {
            localStorage.setItem(GRID_STATE_KEY, JSON.stringify(gridState));
        }
        if (Array.isArray(hiddenImages)) {
            localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(hiddenImages));
        }
    } catch (e) {
        console.warn('[StateSync] Erro ao restaurar estado do servidor.', e);
    }
}

export function loadConfig() {
    try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) return { ...defaultConfig, ...JSON.parse(saved) };
    } catch (e) { }
    return defaultConfig;
}

export function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    try { syncChannel.postMessage({ type: 'CONFIG_UPDATE', data: config }); } catch (e) { }
    scheduleStateSync();
}

export function getHiddenImages() {
    try { return JSON.parse(localStorage.getItem(HIDDEN_IMAGES_KEY) || '[]'); } catch (e) { return []; }
}

export function addHiddenImage(id) {
    const list = getHiddenImages();
    if (!list.includes(id)) {
        list.push(id);
        localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(list));
        try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
        scheduleStateSync();
    }
}

export function removeHiddenImage(id) {
    let list = getHiddenImages();
    list = list.filter(x => x !== id);
    localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(list));
    try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
    scheduleStateSync();
}

export function clearHiddenImages() {
    localStorage.removeItem(HIDDEN_IMAGES_KEY);
    try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
    scheduleStateSync();
}
export const CONFIG_KEY = 'socialWallConfig_v27';
export const GRID_STATE_KEY = 'socialWallGridState_v27';
export const HIDDEN_IMAGES_KEY = 'socialWallHidden_v27';

export const API_BASE_URL = 'http://localhost:3000/api/images';
export const UPLOAD_URL = 'http://localhost:3000/api/upload';

export const syncChannel = new BroadcastChannel('social_wall_sync_channel_v27');

export const defaultConfig = {
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
    exportWithBackground: true,     // se false, exporta só a foto
};


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
    }
}
export function removeHiddenImage(id) {
    let list = getHiddenImages();
    list = list.filter(x => x !== id);
    localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(list));
    try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
}
export function clearHiddenImages() {
    localStorage.removeItem(HIDDEN_IMAGES_KEY);
    try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
}
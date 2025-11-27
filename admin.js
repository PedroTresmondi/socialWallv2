import './style.css';
import {
    saveConfig,
    loadConfig,
    API_BASE_URL,
    GRID_STATE_KEY,
    getHiddenImages,
    clearHiddenImages,
    CONFIG_KEY,
    HIDDEN_IMAGES_KEY,
    addHiddenImage,
    syncChannel,
    restoreStateFromServer
} from './shared.js';

let config = loadConfig();
// garante que o novo campo existe
config.showGridNumber = config.showGridNumber ?? false;

let currentFilter = 'queue'; // Estado inicial da aba (queue, wall, removed)

// --- ELEMENTOS ---
const getEls = () => ({
    layoutMode: document.getElementById('layout-mode'), targetCount: document.getElementById('target-count'),
    gridCols: document.getElementById('grid-cols'), gridRows: document.getElementById('grid-rows'),
    photoW: document.getElementById('photo-width'), photoH: document.getElementById('photo-height'),
    groupTarget: document.getElementById('group-target'), groupAuto: document.getElementById('group-auto-fit'), groupManual: document.getElementById('group-manual'),
    gapIn: document.getElementById('grid-gap'), opacityIn: document.getElementById('image-opacity'),
    bgFileInput: document.getElementById('bg-file-input'), bgStatus: document.getElementById('bg-status'),
    bgBrightness: document.getElementById('bg-brightness'), bgContrast: document.getElementById('bg-contrast'), bgSaturate: document.getElementById('bg-saturate'), bgBlur: document.getElementById('bg-blur'),
    bgBrightnessVal: document.getElementById('bg-brightness-val'), bgContrastVal: document.getElementById('bg-contrast-val'), bgSaturateVal: document.getElementById('bg-saturate-val'), bgBlurVal: document.getElementById('bg-blur-val'),
    animType: document.getElementById('anim-type'), animDur: document.getElementById('anim-duration'), processInterval: document.getElementById('process-interval'),
    toggleBtn: document.getElementById('toggle-processing'),
    randCheck: document.getElementById('random-position'), persistCheck: document.getElementById('persist-state'),
    heroCheck: document.getElementById('hero-enabled'), heroInterval: document.getElementById('hero-interval'),
    idleCheck: document.getElementById('idle-enabled'), idleTimeout: document.getElementById('idle-timeout'),
    removalCheck: document.getElementById('removal-mode'),
    // NOVO: Toggle para número do grid
    showGridNumCheck: document.getElementById('show-grid-num'),

    gapVal: document.getElementById('gap-value'), opacityVal: document.getElementById('opacity-value'), durVal: document.getElementById('duration-value'), procVal: document.getElementById('process-interval-val'),
    heroIntervalVal: document.getElementById('hero-interval-val'), idleTimeoutVal: document.getElementById('idle-timeout-val'),
    slotsFree: document.getElementById('slots-free'), slotsTotal: document.getElementById('slots-total'), queueCount: document.getElementById('queue-count'),
    statBackend: document.getElementById('total-backend-images'),
    logoUrl: document.getElementById('logo-url'), logoPosition: document.getElementById('logo-position'), tickerEnabled: document.getElementById('ticker-enabled'), tickerText: document.getElementById('ticker-text'),
    dropboxToken: document.getElementById('dropbox-token'), dropboxFolder: document.getElementById('dropbox-folder'), dropboxSyncBtn: document.getElementById('dropbox-sync-btn'),
    modeDropboxBtn: document.getElementById('mode-dropbox-btn'), modeLocalBtn: document.getElementById('mode-local-btn'),
    dropboxSettings: document.getElementById('dropbox-settings'), localSettings: document.getElementById('local-settings'),
    statusLog: document.getElementById('status-log'), gallery: document.getElementById('admin-gallery-container'),
    clearHiddenBtn: document.getElementById('clear-hidden-btn'), refreshBtn: document.getElementById('refresh-gallery'),

    // **NOVO: Export Souvenir**
    exportCheck: document.getElementById('export-enabled'),
    exportW: document.getElementById('export-width'),
    exportH: document.getElementById('export-height'),
    exportWithBgCheck: document.getElementById('export-with-bg'),
    // FIM NOVO

    // ABAS
    tabQueue: document.getElementById('tab-queue'),
    tabWall: document.getElementById('tab-wall'),
    tabRemoved: document.getElementById('tab-removed')
});

function showToast(msg, type = 'success') {
    const c = document.getElementById('toast-container'); if (!c) return;
    const t = document.createElement('div'); t.className = 'toast';
    t.style.borderLeftColor = type === 'success' ? '#4ade80' : '#f87171';
    t.innerHTML = `<strong>${type === 'success' ? '✓' : '⚠️'}</strong> ${msg}`;
    c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; setTimeout(() => t.remove(), 300); }, 3000);
}

function calculateEstimatedGrid() {
    if (config.layoutMode === 'target') {
        const t = Math.max(1, config.targetCount || 20);
        const r = 16 / 9;
        config.cols = Math.ceil(Math.sqrt(t * r)); config.rows = Math.ceil(t / config.cols);
        saveConfig(config);
    }
}

setInterval(() => {
    const s = localStorage.getItem(CONFIG_KEY);
    if (s) {
        const d = JSON.parse(s);
        if (d.cols !== config.cols || d.rows !== config.rows) {
            config.cols = d.cols; config.rows = d.rows;
            const els = getEls();
            if (document.activeElement !== els.gridCols && els.gridCols) els.gridCols.value = d.cols;
            if (document.activeElement !== els.gridRows && els.gridRows) els.gridRows.value = d.rows;
            updateStats();
        }
    }
}, 1000);

const change = (key, val, showMsg = false) => {
    config[key] = val;
    if (key === 'targetCount' || key === 'layoutMode') calculateEstimatedGrid();
    saveConfig(config); updateUI(); updateStats();
    if (showMsg) showToast("Salvo");
};

function updateStats(overrideTotal = null) {
    const els = getEls();
    const gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    let total = overrideTotal;
    if (total === null && els.statBackend) total = parseInt(els.statBackend.innerText) || 0;
    const onScreen = gs.filter(id => id !== null).length;
    const hidden = getHiddenImages().length;
    const queue = Math.max(0, total - onScreen - hidden);
    const cap = (config.cols || 1) * (config.rows || 1);
    const free = Math.max(0, cap - onScreen);

    if (els.slotsFree) { els.slotsFree.textContent = free; els.slotsFree.className = free === 0 ? "font-bold text-2xl text-red-500" : "font-bold text-2xl text-green-400"; }
    if (els.slotsTotal) els.slotsTotal.textContent = cap;
    if (els.queueCount) els.queueCount.textContent = queue;
    if (els.statBackend && overrideTotal !== null) els.statBackend.textContent = overrideTotal;
}

function updateUI() {
    const els = getEls();

    // Sync basic inputs...
    if (els.targetCount) els.targetCount.value = config.targetCount || 20;
    if (els.layoutMode) els.layoutMode.value = config.layoutMode || 'target';
    if (els.gridCols) els.gridCols.value = config.cols;
    if (els.gridRows) els.gridRows.value = config.rows;
    if (els.gapIn) els.gapIn.value = config.gap;
    if (els.gapVal) els.gapVal.textContent = config.gap + 'px';
    if (els.opacityIn) els.opacityIn.value = config.opacity * 100;
    if (els.opacityVal) els.opacityVal.textContent = Math.round(config.opacity * 100) + '%';

    if (els.bgBrightness) els.bgBrightness.value = config.bgBrightness;
    if (els.bgBrightnessVal) els.bgBrightnessVal.textContent = config.bgBrightness + '%';
    if (els.bgContrast) els.bgContrast.value = config.bgContrast;
    if (els.bgContrastVal) els.bgContrastVal.textContent = config.bgContrast + '%';
    if (els.bgSaturate) els.bgSaturate.value = config.bgSaturate;
    if (els.bgSaturateVal) els.bgSaturateVal.textContent = config.bgSaturate + '%';
    if (els.bgBlur) els.bgBlur.value = config.bgBlur;
    if (els.bgBlurVal) els.bgBlurVal.textContent = config.bgBlur + 'px';

    if (els.heroInterval) els.heroInterval.value = config.heroInterval;
    if (els.heroIntervalVal) els.heroIntervalVal.textContent = config.heroInterval + 's';
    if (els.idleTimeout) els.idleTimeout.value = config.idleTimeout;
    if (els.idleTimeoutVal) els.idleTimeoutVal.textContent = config.idleTimeout + 's';

    if (els.animType) els.animType.value = config.animType;
    if (els.animDur) els.animDur.value = config.animDuration;
    if (els.processInterval) els.processInterval.value = config.processInterval / 1000;
    if (els.procVal) els.procVal.textContent = (config.processInterval / 1000) + 's';

    if (els.randCheck) els.randCheck.checked = config.randomPosition;
    if (els.persistCheck) els.persistCheck.checked = config.persistGrid;
    if (els.heroCheck) els.heroCheck.checked = config.heroEnabled;
    if (els.idleCheck) els.idleCheck.checked = config.idleEnabled;
    if (els.removalCheck) els.removalCheck.checked = config.removalMode;
    if (els.tickerEnabled) els.tickerEnabled.checked = config.tickerEnabled;

    // NOVO: Toggle do número do grid
    if (els.showGridNumCheck) els.showGridNumCheck.checked = config.showGridNumber;

    if (els.logoUrl) els.logoUrl.value = config.logoUrl || '';
    if (els.logoPosition) els.logoPosition.value = config.logoPosition || 'top-right';
    if (els.tickerText) els.tickerText.value = config.tickerText || '';
    if (els.dropboxToken) els.dropboxToken.value = config.dropboxToken || '';
    if (els.dropboxFolder) els.dropboxFolder.value = config.dropboxFolder || '/';

    // **NOVO: Export Souvenir**
    if (els.exportCheck) els.exportCheck.checked = config.exportEnabled;
    if (els.exportW) els.exportW.value = config.exportWidth;
    if (els.exportH) els.exportH.value = config.exportHeight;
    if (els.exportWithBgCheck) els.exportWithBgCheck.checked = (config.exportWithBackground ?? true);
    // FIM NOVO

    if (els.groupTarget) {
        els.groupTarget.classList.add('hidden'); els.groupAuto.classList.add('hidden'); els.groupManual.classList.add('hidden');
        if (config.layoutMode === 'target') els.groupTarget.classList.remove('hidden');
        else if (config.layoutMode === 'auto-fit') els.groupAuto.classList.remove('hidden');
        else els.groupManual.classList.remove('hidden');
    }

    if (config.sourceMode === 'dropbox') {
        els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:text-white";
        els.dropboxSettings.classList.remove('hidden'); els.localSettings.classList.add('hidden');
    } else {
        els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:text-white";
        els.localSettings.classList.remove('hidden'); els.dropboxSettings.classList.add('hidden');
    }

    if (config.processing && els.toggleBtn) {
        els.toggleBtn.innerHTML = '<span class="text-xl">⏸️</span> PAUSAR';
        els.toggleBtn.className = "w-full p-4 bg-red-600 hover:bg-red-700 rounded-lg font-bold transition mb-6 flex items-center justify-center gap-2 shadow-lg";
    } else if (els.toggleBtn) {
        els.toggleBtn.innerHTML = '<span class="text-xl">▶️</span> INICIAR';
        els.toggleBtn.className = "w-full p-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition mb-6 flex items-center justify-center gap-2 shadow-lg";
    }

    // Atualiza estilo das abas
    const tabs = { 'queue': els.tabQueue, 'wall': els.tabWall, 'removed': els.tabRemoved };
    Object.keys(tabs).forEach(k => {
        if (tabs[k]) {
            if (k === currentFilter) tabs[k].className = "tab-btn active px-4 py-1 text-xs rounded transition bg-blue-600 text-white font-bold shadow-md";
            else tabs[k].className = "tab-btn inactive px-4 py-1 text-xs rounded transition text-slate-400 hover:bg-slate-800";
        }
    });
}

function setupListeners() {
    const els = getEls();
    els.layoutMode.addEventListener('change', e => change('layoutMode', e.target.value, true));
    const numBind = (el, key) => el?.addEventListener('input', e => change(key, parseInt(e.target.value)));
    numBind(els.targetCount, 'targetCount'); numBind(els.gridCols, 'cols'); numBind(els.gridRows, 'rows'); numBind(els.gapIn, 'gap');
    numBind(els.photoW, 'photoWidth'); numBind(els.photoH, 'photoHeight');
    numBind(els.bgBrightness, 'bgBrightness'); numBind(els.bgContrast, 'bgContrast');
    numBind(els.bgSaturate, 'bgSaturate'); numBind(els.bgBlur, 'bgBlur');
    numBind(els.heroInterval, 'heroInterval'); numBind(els.idleTimeout, 'idleTimeout');

    // **NOVO: Listeners de Exportação**
    numBind(els.exportW, 'exportWidth');
    numBind(els.exportH, 'exportHeight');
    // FIM NOVO

    if (els.opacityIn) els.opacityIn.addEventListener('input', e => change('opacity', parseFloat(e.target.value) / 100));
    if (els.animType) els.animType.addEventListener('change', e => change('animType', e.target.value));
    if (els.animDur) els.animDur.addEventListener('input', e => change('animDuration', parseInt(e.target.value)));
    if (els.processInterval) els.processInterval.addEventListener('input', e => change('processInterval', parseFloat(e.target.value) * 1000));

    const chkBind = (el, key) => el?.addEventListener('change', e => change(key, e.target.checked, true));
    chkBind(els.randCheck, 'randomPosition'); chkBind(els.persistCheck, 'persistGrid'); chkBind(els.removalCheck, 'removalMode');
    chkBind(els.heroCheck, 'heroEnabled'); chkBind(els.idleCheck, 'idleEnabled'); chkBind(els.tickerEnabled, 'tickerEnabled');
    // NOVO: Listener do toggle do número do grid
    chkBind(els.showGridNumCheck, 'showGridNumber');

    // **NOVO: Checkbox de Exportação**
    chkBind(els.exportCheck, 'exportEnabled');
    chkBind(els.exportWithBgCheck, 'exportWithBackground');
    // FIM NOVO

    if (els.logoUrl) els.logoUrl.addEventListener('change', e => change('logoUrl', e.target.value));
    if (els.logoPosition) els.logoPosition.addEventListener('change', e => change('logoPosition', e.target.value));
    if (els.tickerText) els.tickerText.addEventListener('change', e => change('tickerText', e.target.value));

    if (els.bgFileInput) {
        els.bgFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const formData = new FormData(); formData.append('background', file);
            els.bgStatus.textContent = "Enviando...";
            try {
                const res = await fetch('http://localhost:3000/api/upload-bg', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json(); change('backgroundUrl', data.url);
                    els.bgStatus.textContent = "Sucesso!"; showToast("Fundo Atualizado");
                } else els.bgStatus.textContent = "Erro.";
            } catch (err) { els.bgStatus.textContent = "Erro conexao."; }
        });
    }

    if (els.modeDropboxBtn) els.modeDropboxBtn.addEventListener('click', () => { config.sourceMode = 'dropbox'; saveConfig(config); updateUI(); startDropboxMonitor(); fetchGallery(); showToast("Modo Dropbox"); });
    if (els.modeLocalBtn) els.modeLocalBtn.addEventListener('click', () => { config.sourceMode = 'local'; saveConfig(config); updateUI(); fetchGallery(); showToast("Modo Local"); });
    if (els.dropboxSyncBtn) els.dropboxSyncBtn.addEventListener('click', () => { config.dropboxToken = els.dropboxToken.value; config.dropboxFolder = els.dropboxFolder.value; saveConfig(config); startDropboxMonitor(); showToast("Sincronizando..."); });
    if (els.toggleBtn) els.toggleBtn.addEventListener('click', () => { change('processing', !config.processing); showToast(config.processing ? "Iniciado" : "Pausado"); });
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => { fetchGallery(); showToast("Lista Atualizada"); });
    if (els.clearHiddenBtn) els.clearHiddenBtn.addEventListener('click', () => { clearHiddenImages(); fetchGallery(); showToast("Bloqueios Limpos"); });

    // LISTENERS DAS ABAS
    const setTab = (tab) => { currentFilter = tab; updateUI(); fetchGallery(); };
    if (els.tabQueue) els.tabQueue.addEventListener('click', () => setTab('queue'));
    if (els.tabWall) els.tabWall.addEventListener('click', () => setTab('wall'));
    if (els.tabRemoved) els.tabRemoved.addEventListener('click', () => setTab('removed'));
}

// CORREÇÃO: Usando a rota /events para SSE
function initStatusMonitor() {
    const el = document.getElementById('status-log');
    if (!el) return;

    const es = new EventSource('http://localhost:3000/events');

    es.onopen = () => console.log("SSE: Conexão de status estabelecida.");
    es.onerror = (err) => {
        console.error("SSE: Erro na conexão de status. Certifique-se que o servidor está rodando.");
        if (el) el.innerHTML = `<div>[ERRO] Falha na conexão com servidor.</div>`;
    };

    es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const div = document.createElement('div');

        const typeClass = d.type === 'error' ? 'text-red-400' : d.type === 'success' ? 'text-green-400' : 'text-slate-300';

        div.className = typeClass;
        div.innerText = `[${d.time}] ${d.msg}`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    };
}

const startDropboxMonitor = async () => { if (!config.dropboxToken) return; try { await fetch('http://localhost:3000/api/dropbox/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: config.dropboxToken, folder: config.dropboxFolder }) }); } catch (e) { } };
async function fetchGallery() { const source = config.sourceMode || 'local'; let url = `http://localhost:3000/api/images?source=${source}`; if (source === 'dropbox') url += `&token=${config.dropboxToken}&folderPath=${config.dropboxFolder}`; try { const res = await fetch(url); const images = await res.json(); renderGallery(images); updateStats(images.length); } catch (e) { } }

// --- RENDERIZADOR DA GALERIA COM FILTROS E NÚMERO DO GRID ---
function renderGallery(images) {
    const els = getEls(); if (!els.gallery) return;
    const gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    const usedIds = new Set(gs.filter(id => id));
    const hiddenIds = getHiddenImages();

    const imageIdToGridPos = {};
    gs.forEach((id, index) => {
        if (id !== null) {
            imageIdToGridPos[id] = index + 1; // Posição 1, 2, 3...
        }
    });
    const showGridNumbers = config.showGridNumber === true;


    // FILTRA A LISTA BASEADA NA ABA ATIVA
    let displayImages = [];
    if (currentFilter === 'queue') {
        displayImages = images.filter(img => !usedIds.has(img.id) && !hiddenIds.includes(img.id));
    } else if (currentFilter === 'wall') {
        displayImages = images.filter(img => usedIds.has(img.id));
    } else if (currentFilter === 'removed') {
        displayImages = images.filter(img => hiddenIds.includes(img.id));
    }

    els.gallery.innerHTML = '';

    if (displayImages.length === 0) {
        const msg = currentFilter === 'queue' ? 'Ninguém na fila' : currentFilter === 'wall' ? 'Telão vazio' : 'Lixeira vazia';
        els.gallery.innerHTML = `<p class="col-span-full text-center py-4 text-slate-500">${msg}</p>`;
        return;
    }

    displayImages.forEach(img => {
        const isOnWall = usedIds.has(img.id);
        const isHidden = hiddenIds.includes(img.id);

        // Exibe o número do grid se estiver na Wall + toggle ligado
        const gridNumber = imageIdToGridPos[img.id];
        const gridNumberDisplay = (showGridNumbers && isOnWall && gridNumber)
            ? `<span class="absolute top-1 right-1 text-white bg-indigo-600 text-[9px] px-1.5 py-0.5 rounded font-bold shadow-sm z-10">#${gridNumber}</span>`
            : '';


        let border = 'border-slate-700 hover:border-slate-500';
        if (isOnWall) border = 'border-green-500 border-2 shadow-[0_0_10px_rgba(74,222,128,0.3)]';
        else if (isHidden) border = 'border-red-900 border-2 opacity-40 grayscale';
        else border = 'border-blue-500/30 border-2'; // Fila

        let badge = '';
        if (isOnWall) badge = '<span class="absolute top-1 left-1 bg-green-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-sm z-10">NA TELA</span>';
        else if (isHidden) badge = '<span class="absolute top-1 left-1 bg-red-900 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-sm z-10">LIXEIRA</span>';
        else badge = '<span class="absolute top-1 left-1 bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-sm z-10">FILA</span>';

        const div = document.createElement('div');
        div.className = `aspect-square bg-slate-800 rounded-lg relative overflow-hidden group border transition-all duration-200 ${border}`;
        div.innerHTML = `
      ${badge}
      ${gridNumberDisplay}
      <img src="${img.url}" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-black/80 hidden group-hover:flex flex-col items-center justify-center gap-2 transition-all backdrop-blur-sm">
        ${isOnWall
                ? `<button onclick="actRem('${img.id}')" class="bg-red-600 hover:bg-red-500 text-white text-[10px] px-3 py-1.5 rounded font-bold w-24">Remover</button>`
                : isHidden
                    ? `<button onclick="actRes('${img.id}')" class="bg-slate-500 hover:bg-slate-400 text-white text-[10px] px-3 py-1.5 rounded font-bold w-24">Restaurar</button>`
                    : `<button onclick="actBlk('${img.id}')" class="bg-red-900 hover:bg-red-800 text-white text-[10px] px-3 py-1.5 rounded font-bold w-24">Bloquear</button>`
            }
        <span class="text-[9px] text-slate-400 font-mono truncate max-w-[90%]">${img.id.substring(0, 15)}...</span>
      </div>
    `;
        els.gallery.appendChild(div);
    });
}

window.actRem = (id) => {
    addHiddenImage(id);
    let gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    gs = gs.map(x => x === id ? null : x);
    localStorage.setItem(GRID_STATE_KEY, JSON.stringify(gs));
    saveConfig(config);
    fetchGallery();
    showToast("Removido e Arquivado");
};

window.actBlk = (id) => {
    addHiddenImage(id);
    let gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    if (gs.includes(id)) {
        gs = gs.map(x => x === id ? null : x);
        localStorage.setItem(GRID_STATE_KEY, JSON.stringify(gs));
    }
    saveConfig(config);
    fetchGallery();
    showToast("Bloqueado");
};

window.actRes = (id) => {
    let h = JSON.parse(localStorage.getItem(HIDDEN_IMAGES_KEY) || '[]').filter(x => x !== id);
    localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(h));
    try { syncChannel.postMessage({ type: 'HIDDEN_UPDATE' }); } catch (e) { }
    fetchGallery();
    showToast("Restaurado para Fila");
};

// --- BOOT ---
async function bootAdmin() {
    await restoreStateFromServer();
    config = loadConfig();

    initStatusMonitor();
    updateUI();
    setupListeners();
    setInterval(fetchGallery, 3000);
    fetchGallery();
}

bootAdmin();

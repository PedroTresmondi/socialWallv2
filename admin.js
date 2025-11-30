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
    // layout / grid
    layoutMode: document.getElementById('layout-mode'),
    targetCount: document.getElementById('target-count'),
    gridCols: document.getElementById('grid-cols'),
    gridRows: document.getElementById('grid-rows'),
    photoW: document.getElementById('photo-width'),
    photoH: document.getElementById('photo-height'),
    groupTarget: document.getElementById('group-target'),
    groupAuto: document.getElementById('group-auto-fit'),
    groupManual: document.getElementById('group-manual'),
    gapIn: document.getElementById('grid-gap'),
    opacityIn: document.getElementById('image-opacity'),

    // bg / filtros
    bgFileInput: document.getElementById('bg-file-input'),
    bgStatus: document.getElementById('bg-status'),
    bgBrightness: document.getElementById('bg-brightness'),
    bgContrast: document.getElementById('bg-contrast'),
    bgSaturate: document.getElementById('bg-saturate'),
    bgBlur: document.getElementById('bg-blur'),
    bgBrightnessVal: document.getElementById('bg-brightness-val'),
    bgContrastVal: document.getElementById('bg-contrast-val'),
    bgSaturateVal: document.getElementById('bg-saturate-val'),
    bgBlurVal: document.getElementById('bg-blur-val'),

    // comportamento
    animType: document.getElementById('anim-type'),
    animDur: document.getElementById('anim-duration'),
    processInterval: document.getElementById('process-interval'),
    toggleBtn: document.getElementById('toggle-processing'),
    randCheck: document.getElementById('random-position'),
    persistCheck: document.getElementById('persist-state'),
    heroCheck: document.getElementById('hero-enabled'),
    heroInterval: document.getElementById('hero-interval'),
    idleCheck: document.getElementById('idle-enabled'),
    idleTimeout: document.getElementById('idle-timeout'),
    removalCheck: document.getElementById('removal-mode'),

    // toggle número do grid
    showGridNumCheck: document.getElementById('show-grid-num'),

    // labels de UI
    gapVal: document.getElementById('gap-value'),
    opacityVal: document.getElementById('opacity-value'),
    procVal: document.getElementById('process-interval-val'),
    heroIntervalVal: document.getElementById('hero-interval-val'),
    idleTimeoutVal: document.getElementById('idle-timeout-val'),
    slotsFree: document.getElementById('slots-free'),
    slotsTotal: document.getElementById('slots-total'),
    queueCount: document.getElementById('queue-count'),
    statBackend: document.getElementById('total-backend-images'),

    // branding / outros
    logoUrl: document.getElementById('logo-url'),
    logoPosition: document.getElementById('logo-position'),
    tickerEnabled: document.getElementById('ticker-enabled'),
    tickerText: document.getElementById('ticker-text'),

    // dropbox/local
    dropboxToken: document.getElementById('dropbox-token'),
    dropboxFolder: document.getElementById('dropbox-folder'),
    dropboxSyncBtn: document.getElementById('dropbox-sync-btn'),
    modeDropboxBtn: document.getElementById('mode-dropbox-btn'),
    modeLocalBtn: document.getElementById('mode-local-btn'),
    dropboxSettings: document.getElementById('dropbox-settings'),
    localSettings: document.getElementById('local-settings'),

    statusLog: document.getElementById('status-log'),
    gallery: document.getElementById('admin-gallery-container'),
    clearHiddenBtn: document.getElementById('clear-hidden-btn'),
    refreshBtn: document.getElementById('refresh-gallery'),

    // Export Souvenir
    exportCheck: document.getElementById('export-enabled'),
    exportW: document.getElementById('export-width'),
    exportH: document.getElementById('export-height'),
    exportWithBgCheck: document.getElementById('export-with-bg'),

    // ABAS
    tabQueue: document.getElementById('tab-queue'),
    tabWall: document.getElementById('tab-wall'),
    tabRemoved: document.getElementById('tab-removed'),

    // Preview do grid
    gridPreviewInner: document.getElementById('grid-preview-inner'),
    gridPreviewLabel: document.getElementById('grid-preview-label'),

    // Relatório de evento
    eventReportTotal: document.getElementById('event-report-total'),
    eventReportFirst: document.getElementById('event-report-first'),
    eventReportLast: document.getElementById('event-report-last'),
    eventReportAvg: document.getElementById('event-report-avg'),
    eventReportEmpty: document.getElementById('event-report-empty'),
    eventReportRefresh: document.getElementById('event-report-refresh'),
    downloadCsvBtn: document.getElementById('download-csv-btn'),
    cleanupExportsBtn: document.getElementById('cleanup-exports-btn'),
    resetEventBtn: document.getElementById('reset-event-btn'),

    // badge do servidor
    serverStatusBadge: document.getElementById('server-status-badge')
});

function showToast(msg, type = 'success') {
    const c = document.getElementById('toast-container'); if (!c) return;
    const t = document.createElement('div'); t.className = 'toast';
    t.style.borderLeftColor = type === 'success' ? '#4ade80' : '#f87171';
    t.innerHTML = `<strong>${type === 'success' ? '✓' : '⚠️'}</strong> ${msg}`;
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(100%)';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// --- GRID ESTIMADO (modo target) ---
function calculateEstimatedGrid() {
    if (config.layoutMode === 'target') {
        const t = Math.max(1, config.targetCount || 20);
        const r = 16 / 9;
        config.cols = Math.ceil(Math.sqrt(t * r));
        config.rows = Math.ceil(t / config.cols);
        saveConfig(config);
    }
}

// sincroniza se outro tab mexer no config
setInterval(() => {
    const s = localStorage.getItem(CONFIG_KEY);
    if (s) {
        const d = JSON.parse(s);
        if (d.cols !== config.cols || d.rows !== config.rows || d.layoutMode !== config.layoutMode) {
            config = { ...config, ...d };
            const els = getEls();
            if (els.gridCols && document.activeElement !== els.gridCols) els.gridCols.value = config.cols;
            if (els.gridRows && document.activeElement !== els.gridRows) els.gridRows.value = config.rows;
            updateStats();
            updateUI();
        }
    }
}, 1000);

const change = (key, val, showMsg = false) => {
    config[key] = val;
    if (key === 'targetCount' || key === 'layoutMode') calculateEstimatedGrid();
    saveConfig(config);
    updateUI();
    updateStats();
    if (showMsg) showToast("Salvo");
};

// --- PREVIEW DO GRID (slots ocupados x vazios) ---
function renderGridPreview() {
    const els = getEls();
    const container = els.gridPreviewInner;
    if (!container) return;

    const cols = config.cols || 1;
    const rows = config.rows || 1;
    const totalSlots = cols * rows;

    let gridState = [];
    try {
        gridState = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    } catch (e) { }

    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    container.style.gap = '2px';

    for (let i = 0; i < totalSlots; i++) {
        const occupied = gridState[i] != null;
        const cell = document.createElement('div');
        cell.className =
            'flex items-center justify-center text-[9px] rounded-sm border ' +
            (occupied
                ? 'bg-emerald-600/70 border-emerald-400 text-emerald-50'
                : 'bg-slate-900/60 border-slate-700 text-slate-500');
        cell.textContent = `#${i + 1}`;
        container.appendChild(cell);
    }

    if (els.gridPreviewLabel) {
        els.gridPreviewLabel.textContent =
            `${cols} colunas × ${rows} linhas • ${totalSlots} slots`;
    }
}

function updateGridPreview() {
    const preview = document.getElementById('grid-preview-inner');
    const label = document.getElementById('grid-preview-label');
    if (!preview || !label || !config) return;

    const cols = config.cols || 1;
    const rows = config.rows || 1;
    const totalSlots = cols * rows;

    // Carrega estado do grid (se existir)
    let gridState = [];
    if (config.persistGrid) {
        try {
            gridState = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
        } catch (e) {
            gridState = [];
        }
    }

    // Normaliza tamanho do array
    if (gridState.length < totalSlots) {
        gridState = gridState.concat(Array(totalSlots - gridState.length).fill(null));
    } else if (gridState.length > totalSlots) {
        gridState = gridState.slice(0, totalSlots);
    }

    const hidden = (typeof getHiddenImages === 'function') ? getHiddenImages() : [];
    const hiddenSet = new Set(hidden);

    preview.innerHTML = '';
    preview.style.display = 'grid';
    preview.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    preview.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    preview.style.overflow = 'hidden';

    // ---- AJUSTES VISUAIS CONFORME TAMANHO DO GRID ----
    let cellGap = 2;
    let fontSizePx = 9;
    let showNumbers = true;

    if (totalSlots > 150) {
        // grid MUITO grande → só quadradinhos coloridos
        cellGap = 1;
        fontSizePx = 0;       // sem texto
        showNumbers = false;
    } else if (totalSlots > 80) {
        cellGap = 1;
        fontSizePx = 7;
    }

    preview.style.gap = `${cellGap}px`;

    let usedCount = 0;

    for (let i = 0; i < totalSlots; i++) {
        const id = gridState[i] || null;
        const cell = document.createElement('div');

        cell.style.borderRadius = '2px';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.userSelect = 'none';
        cell.style.lineHeight = '1';
        if (fontSizePx > 0) cell.style.fontSize = `${fontSizePx}px`;

        if (!id) {
            // vazio
            cell.style.background = 'rgba(15,23,42,0.9)';
            cell.style.border = '1px solid rgba(51,65,85,0.9)';
        } else {
            usedCount++;
            if (hiddenSet.has(id)) {
                // bloqueado / hidden
                cell.style.background = 'rgba(127,29,29,0.7)';
                cell.style.border = '1px solid rgba(248,113,113,0.9)';
            } else {
                // ocupado
                cell.style.background = 'rgba(22,163,74,0.7)';
                cell.style.border = '1px solid rgba(34,197,94,0.9)';
            }
        }

        if (showNumbers) {
            cell.textContent = `#${i + 1}`;
        }

        preview.appendChild(cell);
    }

    const freeCount = totalSlots - usedCount;
    label.textContent = `${cols} colunas x ${rows} linhas • Slots: ${totalSlots} • Ocupados: ${usedCount} • Livres: ${freeCount}`;
}



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

    if (els.slotsFree) {
        els.slotsFree.textContent = free;
        els.slotsFree.className =
            free === 0
                ? "font-bold text-2xl text-red-500"
                : "font-bold text-2xl text-green-400";
    }
    if (els.slotsTotal) els.slotsTotal.textContent = cap;
    if (els.queueCount) els.queueCount.textContent = queue;

    if (els.statBackend && overrideTotal !== null) els.statBackend.textContent = overrideTotal;

    renderGridPreview();
}

function updateUI() {
    const els = getEls();

    // Sync básicos
    if (els.targetCount) els.targetCount.value = config.targetCount || 20;
    if (els.layoutMode) els.layoutMode.value = config.layoutMode || 'target';
    if (els.gridCols) els.gridCols.value = config.cols;
    if (els.gridRows) els.gridRows.value = config.rows;
    if (els.gapIn) els.gapIn.value = config.gap;
    if (els.gapVal) els.gapVal.textContent = config.gap + 'px';
    if (els.opacityIn) els.opacityIn.value = (config.opacity || 1) * 100;
    if (els.opacityVal) els.opacityVal.textContent = Math.round((config.opacity || 1) * 100) + '%';

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
    if (els.processInterval) els.processInterval.value = (config.processInterval || 3000) / 1000;
    if (els.procVal) els.procVal.textContent = ((config.processInterval || 3000) / 1000) + 's';

    if (els.randCheck) els.randCheck.checked = config.randomPosition;
    if (els.persistCheck) els.persistCheck.checked = config.persistGrid;
    if (els.heroCheck) els.heroCheck.checked = config.heroEnabled;
    if (els.idleCheck) els.idleCheck.checked = config.idleEnabled;
    if (els.removalCheck) els.removalCheck.checked = config.removalMode;
    if (els.tickerEnabled) els.tickerEnabled.checked = config.tickerEnabled;

    // toggle número do grid
    if (els.showGridNumCheck) els.showGridNumCheck.checked = config.showGridNumber;

    if (els.logoUrl) els.logoUrl.value = config.logoUrl || '';
    if (els.logoPosition) els.logoPosition.value = config.logoPosition || 'top-right';
    if (els.tickerText) els.tickerText.value = config.tickerText || '';
    if (els.dropboxToken) els.dropboxToken.value = config.dropboxToken || '';
    if (els.dropboxFolder) els.dropboxFolder.value = config.dropboxFolder || '/';

    // Export
    if (els.exportCheck) els.exportCheck.checked = config.exportEnabled;
    if (els.exportW) els.exportW.value = config.exportWidth;
    if (els.exportH) els.exportH.value = config.exportHeight;
    if (els.exportWithBgCheck) els.exportWithBgCheck.checked = (config.exportWithBackground ?? true);

    if (els.groupTarget) {
        els.groupTarget.classList.add('hidden');
        els.groupAuto?.classList.add('hidden');
        els.groupManual?.classList.add('hidden');
        if (config.layoutMode === 'target') els.groupTarget.classList.remove('hidden');
        else if (config.layoutMode === 'auto-fit') els.groupAuto?.classList.remove('hidden');
        else els.groupManual?.classList.remove('hidden');
    }

    if (config.sourceMode === 'dropbox') {
        if (els.modeDropboxBtn)
            els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        if (els.modeLocalBtn)
            els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:text-white";
        els.dropboxSettings?.classList.remove('hidden');
        els.localSettings?.classList.add('hidden');
    } else {
        if (els.modeLocalBtn)
            els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        if (els.modeDropboxBtn)
            els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:text-white";
        els.localSettings?.classList.remove('hidden');
        els.dropboxSettings?.classList.add('hidden');
    }

    if (config.processing && els.toggleBtn) {
        els.toggleBtn.innerHTML = '<span class="text-xl" id="toggle-icon">⏸️</span> <span id="toggle-text">PAUSAR</span>';
        els.toggleBtn.className = "w-full p-4 bg-red-600 hover:bg-red-700 rounded-lg font-bold transition mb-6 flex items-center justify-center gap-2 shadow-lg";
    } else if (els.toggleBtn) {
        els.toggleBtn.innerHTML = '<span class="text-xl" id="toggle-icon">▶️</span> <span id="toggle-text">INICIAR</span>';
        els.toggleBtn.className = "w-full p-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition mb-6 flex items-center justify-center gap-2 shadow-lg";
    }

    // abas
    const tabs = { 'queue': els.tabQueue, 'wall': els.tabWall, 'removed': els.tabRemoved };
    Object.keys(tabs).forEach(k => {
        const btn = tabs[k];
        if (!btn) return;
        if (k === currentFilter)
            btn.className = "tab-btn active px-4 py-1 text-xs rounded transition bg-blue-600 text-white font-bold shadow-md";
        else
            btn.className = "tab-btn inactive px-4 py-1 text-xs rounded transition text-slate-400 hover:bg-slate-800";
    });

    renderGridPreview();
    updateGridPreview();
}

function setupListeners() {
    const els = getEls();

    // layout
    if (els.layoutMode) els.layoutMode.addEventListener('change', e => change('layoutMode', e.target.value, true));
    const numBind = (el, key) => el?.addEventListener('input', e => change(key, parseInt(e.target.value)));
    numBind(els.targetCount, 'targetCount');
    numBind(els.gridCols, 'cols');
    numBind(els.gridRows, 'rows');
    numBind(els.gapIn, 'gap');
    numBind(els.photoW, 'photoWidth');
    numBind(els.photoH, 'photoHeight');
    numBind(els.bgBrightness, 'bgBrightness');
    numBind(els.bgContrast, 'bgContrast');
    numBind(els.bgSaturate, 'bgSaturate');
    numBind(els.bgBlur, 'bgBlur');
    numBind(els.heroInterval, 'heroInterval');
    numBind(els.idleTimeout, 'idleTimeout');

    // export
    numBind(els.exportW, 'exportWidth');
    numBind(els.exportH, 'exportHeight');

    if (els.opacityIn)
        els.opacityIn.addEventListener('input', e => change('opacity', parseFloat(e.target.value) / 100));
    if (els.animType)
        els.animType.addEventListener('change', e => change('animType', e.target.value));
    if (els.animDur)
        els.animDur.addEventListener('input', e => change('animDuration', parseInt(e.target.value)));
    if (els.processInterval)
        els.processInterval.addEventListener('input', e => change('processInterval', parseFloat(e.target.value) * 1000));

    const chkBind = (el, key) => el?.addEventListener('change', e => change(key, e.target.checked, true));
    chkBind(els.randCheck, 'randomPosition');
    chkBind(els.persistCheck, 'persistGrid');
    chkBind(els.removalCheck, 'removalMode');
    chkBind(els.heroCheck, 'heroEnabled');
    chkBind(els.idleCheck, 'idleEnabled');
    chkBind(els.tickerEnabled, 'tickerEnabled');
    chkBind(els.showGridNumCheck, 'showGridNumber');
    chkBind(els.exportCheck, 'exportEnabled');
    chkBind(els.exportWithBgCheck, 'exportWithBackground');

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

    if (els.modeDropboxBtn)
        els.modeDropboxBtn.addEventListener('click', () => {
            config.sourceMode = 'dropbox'; saveConfig(config); updateUI(); startDropboxMonitor(); fetchGallery(); showToast("Modo Dropbox");
        });
    if (els.modeLocalBtn)
        els.modeLocalBtn.addEventListener('click', () => {
            config.sourceMode = 'local'; saveConfig(config); updateUI(); fetchGallery(); showToast("Modo Local");
        });
    if (els.dropboxSyncBtn)
        els.dropboxSyncBtn.addEventListener('click', () => {
            config.dropboxToken = els.dropboxToken.value;
            config.dropboxFolder = els.dropboxFolder.value;
            saveConfig(config);
            startDropboxMonitor();
            showToast("Sincronizando...");
        });
    if (els.toggleBtn)
        els.toggleBtn.addEventListener('click', () => {
            change('processing', !config.processing);
            showToast(config.processing ? "Iniciado" : "Pausado");
        });
    if (els.refreshBtn)
        els.refreshBtn.addEventListener('click', () => { fetchGallery(); showToast("Lista Atualizada"); });
    if (els.clearHiddenBtn)
        els.clearHiddenBtn.addEventListener('click', () => { clearHiddenImages(); fetchGallery(); showToast("Bloqueios Limpos"); });

    // abas
    const setTab = (tab) => { currentFilter = tab; updateUI(); fetchGallery(); };
    if (els.tabQueue) els.tabQueue.addEventListener('click', () => setTab('queue'));
    if (els.tabWall) els.tabWall.addEventListener('click', () => setTab('wall'));
    if (els.tabRemoved) els.tabRemoved.addEventListener('click', () => setTab('removed'));

    // Relatório de evento
    if (els.eventReportRefresh)
        els.eventReportRefresh.addEventListener('click', () => {
            loadEventReport(true);
        });

    if (els.downloadCsvBtn)
        els.downloadCsvBtn.addEventListener('click', () => {
            window.open('http://localhost:3000/exports/exports.csv', '_blank');
        });

    if (els.cleanupExportsBtn)
        els.cleanupExportsBtn.addEventListener('click', async () => {
            if (!confirm('Remover exports antigos (mais de 1 dia)?')) return;
            try {
                const res = await fetch('http://localhost:3000/exports/cleanup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ days: 1 })
                });
                if (res.ok) {
                    const data = await res.json();
                    showToast(`Exports limpos: ${data.removed} arquivo(s).`);
                    loadEventReport();
                } else {
                    showToast('Erro ao limpar exports.', 'error');
                }
            } catch {
                showToast('Falha de conexão ao limpar exports.', 'error');
            }
        });

    if (els.resetEventBtn)
        els.resetEventBtn.addEventListener('click', async () => {
            if (!confirm('Tem certeza que deseja resetar o evento? Isso limpa layout e bloqueios locais.')) return;
            try {
                const res = await fetch('http://localhost:3000/api/reset-event', {
                    method: 'POST'
                });
                if (!res.ok) throw new Error('Erro HTTP');

                // limpa estado local
                localStorage.removeItem(CONFIG_KEY);
                localStorage.removeItem(GRID_STATE_KEY);
                localStorage.removeItem(HIDDEN_IMAGES_KEY);

                showToast('Evento resetado. Recarregando...', 'success');
                setTimeout(() => {
                    location.reload();
                }, 800);
            } catch {
                showToast('Erro ao resetar evento.', 'error');
            }
        });
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

const startDropboxMonitor = async () => {
    if (!config.dropboxToken) return;
    try {
        await fetch('http://localhost:3000/api/dropbox/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: config.dropboxToken, folder: config.dropboxFolder })
        });
    } catch (e) { }
};

async function fetchGallery() {
    const source = config.sourceMode || 'local';
    let url = `http://localhost:3000/api/images?source=${source}`;
    if (source === 'dropbox') url += `&token=${config.dropboxToken}&folderPath=${config.dropboxFolder}`;
    try {
        const res = await fetch(url);
        const images = await res.json();
        renderGallery(images);
        updateStats(images.length);
    } catch (e) { }
}

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

    renderGridPreview();
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

// --- RELATÓRIO DO EVENTO ---
async function loadEventReport(showToastFlag = false) {
    const els = getEls();
    if (!els.eventReportTotal) return;

    try {
        const res = await fetch('http://localhost:3000/exports/events', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const summary = Array.isArray(data) && data.length ? data[0] : null;

        if (!summary || !summary.totalExports) {
            els.eventReportTotal.textContent = '0';
            els.eventReportFirst.textContent = '--';
            els.eventReportLast.textContent = '--';
            els.eventReportAvg.textContent = '--';
            if (els.eventReportEmpty) els.eventReportEmpty.classList.remove('hidden');
        } else {
            els.eventReportTotal.textContent = summary.totalExports;
            const first = new Date(summary.firstExportAt);
            const last = new Date(summary.lastExportAt);
            els.eventReportFirst.textContent = first.toLocaleString('pt-BR');
            els.eventReportLast.textContent = last.toLocaleString('pt-BR');
            els.eventReportAvg.textContent = Math.round(summary.avgIntervalMs) + ' ms';

            if (els.eventReportEmpty) els.eventReportEmpty.classList.add('hidden');
        }

        if (showToastFlag) showToast('Relatório atualizado.');
    } catch (e) {
        els.eventReportTotal.textContent = '0';
        els.eventReportFirst.textContent = '--';
        els.eventReportLast.textContent = '--';
        els.eventReportAvg.textContent = '--';
        if (els.eventReportEmpty) els.eventReportEmpty.classList.remove('hidden');
        if (showToastFlag) showToast('Erro ao carregar relatório.', 'error');
    }
}

// --- STATUS DO SERVIDOR (badge) ---
function setServerStatus(online) {
    const els = getEls();
    const badge = els.serverStatusBadge;
    if (!badge) return;

    const dot = badge.querySelector('.status-dot');
    const label = badge.querySelector('.status-label');

    if (online) {
        badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold bg-emerald-900/60 text-emerald-200 border border-emerald-500/60';
        if (dot) dot.className = 'status-dot w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]';
        if (label) label.textContent = 'Servidor ON';
    } else {
        badge.className = 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold bg-red-900/60 text-red-200 border border-red-500/60';
        if (dot) dot.className = 'status-dot w-2 h-2 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]';
        if (label) label.textContent = 'Servidor OFF';
    }
}

async function checkServerHealth() {
    try {
        const res = await fetch('http://localhost:3000/health', { cache: 'no-store' });
        setServerStatus(res.ok);
    } catch {
        setServerStatus(false);
    }
}

// --- BOOT ---
async function bootAdmin() {
    await restoreStateFromServer();
    config = loadConfig();

    initStatusMonitor();
    updateUI();
    setupListeners();
    setInterval(fetchGallery, 3000);
    fetchGallery();

    loadEventReport();
    checkServerHealth();
    setInterval(checkServerHealth, 5000);
}

bootAdmin();

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

// Garante defaults
config.overlayStrength = typeof config.overlayStrength === 'number' ? config.overlayStrength : 100;
config.showGridNumber = config.showGridNumber ?? false;
config.entryAnimation = config.entryAnimation ?? true;
// Novos defaults de animação
config.entryDuration = config.entryDuration || 3000;
config.entryAnimSpeed = config.entryAnimSpeed || 500;
config.entryScale = config.entryScale || 1.5;

config.eventName = config.eventName || '';
config.screenWidth = config.screenWidth || 1920;
config.screenHeight = config.screenHeight || 1080;
config.exportBaseFolder = config.exportBaseFolder || '';
config.adminMode = config.adminMode || 'setup';

// --- ESTADO LOCAL ---
let currentFilter = 'queue';
let wizardCurrentStep = 1;
let lastImageIds = new Set();
let errorCount = 0;

// Mapa para preview
let allImagesMap = new Map();

// --- ELEMENTOS UI ---
const getEls = () => ({
    // Layout
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

    // Bg / Filtros
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

    // Overlay Strength
    overlayStrength: document.getElementById('overlay-strength'),
    overlayStrengthVal: document.getElementById('overlay-strength-val'),

    // Comportamento
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
    showGridNumCheck: document.getElementById('show-grid-num'),

    // Animação de Chegada
    entryAnimation: document.getElementById('entry-animation'),
    entryAnimationMini: document.getElementById('entry-animation-mini'),
    // 🟢 NOVOS ELEMENTOS CAPTURADOS
    entryDuration: document.getElementById('entry-duration'),
    entrySpeed: document.getElementById('entry-speed'),
    entryScale: document.getElementById('entry-scale'),

    // Labels
    entryDurationVal: document.getElementById('entry-duration-val'),
    entrySpeedVal: document.getElementById('entry-speed-val'),
    entryScaleVal: document.getElementById('entry-scale-val'),

    gapVal: document.getElementById('gap-value'),
    opacityVal: document.getElementById('opacity-value'),
    procVal: document.getElementById('process-interval-val'),
    heroIntervalVal: document.getElementById('hero-interval-val'),
    idleTimeoutVal: document.getElementById('idle-timeout-val'),
    slotsFree: document.getElementById('slots-free'),
    slotsTotal: document.getElementById('slots-total'),
    queueCount: document.getElementById('queue-count'),
    statBackend: document.getElementById('total-backend-images'),

    // Branding
    logoUrl: document.getElementById('logo-url'),
    logoPosition: document.getElementById('logo-position'),
    tickerEnabled: document.getElementById('ticker-enabled'),
    tickerText: document.getElementById('ticker-text'),

    // Fonte
    dropboxToken: document.getElementById('dropbox-token'),
    dropboxFolder: document.getElementById('dropbox-folder'),
    dropboxSyncBtn: document.getElementById('dropbox-sync-btn'),
    modeDropboxBtn: document.getElementById('mode-dropbox-btn'),
    modeLocalBtn: document.getElementById('mode-local-btn'),
    dropboxSettings: document.getElementById('dropbox-settings'),
    localSettings: document.getElementById('local-settings'),

    // Logs / Galeria
    statusLog: document.getElementById('status-log'),
    statusLastError: document.getElementById('status-last-error'),
    statusErrorCounter: document.getElementById('status-error-counter'),
    statusLogClearBtn: document.getElementById('status-log-clear'),
    gallery: document.getElementById('admin-gallery-container'),
    clearHiddenBtn: document.getElementById('clear-hidden-btn'),
    refreshBtn: document.getElementById('refresh-gallery'),

    // Export Settings
    exportCheck: document.getElementById('export-enabled'),
    exportW: document.getElementById('export-width'),
    exportH: document.getElementById('export-height'),
    exportWithBgCheck: document.getElementById('export-with-bg'),

    // Preview Export
    previewGenerateBtn: document.getElementById('preview-generate-btn'),
    previewOrigImg: document.getElementById('preview-photo-original'),
    previewExportImg: document.getElementById('preview-photo-export'),
    previewOrigPh: document.getElementById('preview-photo-placeholder'),
    previewExportPh: document.getElementById('preview-export-placeholder'),

    // Abas
    tabQueue: document.getElementById('tab-queue'),
    tabWall: document.getElementById('tab-wall'),
    tabRemoved: document.getElementById('tab-removed'),

    // Preview Grid
    gridPreviewInner: document.getElementById('grid-preview-inner'),
    gridPreviewLabel: document.getElementById('grid-preview-label'),

    // Relatório
    eventReportTotal: document.getElementById('event-report-total'),
    eventReportFirst: document.getElementById('event-report-first'),
    eventReportLast: document.getElementById('event-report-last'),
    eventReportAvg: document.getElementById('event-report-avg'),
    eventReportEmpty: document.getElementById('event-report-empty'),
    eventReportRefresh: document.getElementById('event-report-refresh'),
    downloadCsvBtn: document.getElementById('download-csv-btn'),
    cleanupExportsBtn: document.getElementById('cleanup-exports-btn'),
    resetEventBtn: document.getElementById('reset-event-btn'),

    // Status
    serverStatusBadge: document.getElementById('server-status-badge'),

    // Wizard
    wizardStep1Btn: document.getElementById('wizard-step-1-btn'),
    wizardStep2Btn: document.getElementById('wizard-step-2-btn'),
    wizardStep3Btn: document.getElementById('wizard-step-3-btn'),
    wizardStep4Btn: document.getElementById('wizard-step-4-btn'),
    wizardPrev: document.getElementById('wizard-prev'),
    wizardNext: document.getElementById('wizard-next'),
    wizardEventNameInput: document.getElementById('event-name'),
    wizardEventNamePreview: document.getElementById('wizard-event-name-preview'),
    screenPreset1080p: document.getElementById('screen-preset-1080p'),
    screenPreset4k: document.getElementById('screen-preset-4k'),
    screenPresetCustom: document.getElementById('screen-preset-custom'),
    screenWidth: document.getElementById('screen-width'),
    screenHeight: document.getElementById('screen-height'),
    screenResSummary: document.getElementById('screen-res-summary'),
    wizardLayoutTargetBtn: document.getElementById('wizard-layout-target-btn'),
    wizardLayoutAutoFitBtn: document.getElementById('wizard-layout-autofit-btn'),
    wizardLayoutManualBtn: document.getElementById('wizard-layout-manual-btn'),
    wizardLayoutLabel: document.getElementById('wizard-grid-preview-label'),
    wizardExportBaseFolder: document.getElementById('export-base-folder'),
    wizardExportSummary: document.getElementById('wizard-export-summary'),

    // Nav
    sectionNavBtns: document.querySelectorAll('.section-nav-btn'),
    modeSetupBtn: document.getElementById('mode-setup-btn'),
    modeLiveBtn: document.getElementById('mode-live-btn'),

    // Backup
    configDownloadBtn: document.getElementById('config-download-btn'),
    configUploadInput: document.getElementById('config-upload-input')
});

function updateServerStatus(isOnline) {
    const els = getEls();
    const badge = els.serverStatusBadge;
    if (!badge) return;

    const dot = badge.querySelector('.status-dot');
    const label = badge.querySelector('.status-label');

    // Limpa classes básicas
    badge.classList.remove(
        'bg-red-900/60', 'text-red-200', 'border-red-500/60',
        'bg-emerald-900/60', 'text-emerald-200', 'border-emerald-500/60'
    );

    if (isOnline) {
        // ONLINE (verde)
        badge.classList.add('bg-emerald-900/60', 'text-emerald-200', 'border-emerald-500/60');
        if (dot) {
            dot.classList.remove('bg-red-400');
            dot.classList.add('bg-emerald-400');
        }
        if (label) label.textContent = 'Servidor ON';
    } else {
        // OFFLINE (vermelho)
        badge.classList.add('bg-red-900/60', 'text-red-200', 'border-red-500/60');
        if (dot) {
            dot.classList.remove('bg-emerald-400');
            dot.classList.add('bg-red-400');
        }
        if (label) label.textContent = 'Servidor OFF';
    }
}


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

// --- PREVIEW EXPORT ---
async function generatePreview() {
    const els = getEls();
    const btn = els.previewGenerateBtn;

    if (btn) {
        btn.disabled = true;
        btn.textContent = "Gerando...";
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
        const source = config.sourceMode || 'local';
        let url = `http://localhost:3000/api/images?source=${source}`;
        if (source === 'dropbox') url += `&token=${config.dropboxToken}&folderPath=${config.dropboxFolder}`;

        const resList = await fetch(url);
        const images = await resList.json();

        if (!images || images.length === 0) {
            showToast("Nenhuma foto encontrada para prévia.", "error");
            return;
        }

        const latestImage = images[images.length - 1];

        if (els.previewOrigImg) {
            els.previewOrigImg.src = latestImage.url;
            els.previewOrigImg.classList.remove('hidden');
        }
        if (els.previewOrigPh) els.previewOrigPh.classList.add('hidden');

        const cols = config.cols || 1;
        const rows = config.rows || 1;
        const screenW = config.screenWidth || 1920;
        const screenH = config.screenHeight || 1080;

        const slotW = Math.floor(screenW / cols);
        const slotH = Math.floor(screenH / rows);
        const slotCoords = { x: 0, y: 0, w: slotW, h: slotH };

        const exportData = {
            photoId: latestImage.id,
            backgroundUrl: config.backgroundUrl,
            tile: { row: 0, col: 0, cols, rows },
            slotCoords: slotCoords,
            exportSize: {
                w: config.exportWidth || 300,
                h: config.exportHeight || 300
            },
            opacity: config.opacity || 1,
            gridNumber: config.showGridNumber ? 1 : null,
            bgFilters: {
                brightness: config.bgBrightness ?? 100,
                contrast: config.bgContrast ?? 100,
                saturate: config.bgSaturate ?? 100,
                blur: config.bgBlur ?? 0
            },
            overlayStrength: config.overlayStrength ?? 100
        };

        const resExp = await fetch('http://localhost:3000/api/export-collage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportData)
        });

        if (!resExp.ok) throw new Error("Erro no servidor ao gerar colagem");

        const data = await resExp.json();

        if (data.url && els.previewExportImg) {
            els.previewExportImg.src = data.url + "?t=" + Date.now();
            els.previewExportImg.classList.remove('hidden');
            if (els.previewExportPh) els.previewExportPh.classList.add('hidden');
            showToast("Prévia gerada com sucesso!");
        }

    } catch (e) {
        console.error(e);
        showToast("Erro ao gerar prévia: " + e.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Gerar prévia com a última foto";
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

// --- CALCULO GRID ---
function calculateEstimatedGrid() {
    if (config.layoutMode === 'target') {
        const t = Math.max(1, config.targetCount || 20);
        const r = 16 / 9;
        config.cols = Math.ceil(Math.sqrt(t * r));
        config.rows = Math.ceil(t / config.cols);
        saveConfig(config);
    }
}

// Sincronia
setInterval(() => {
    const s = localStorage.getItem(CONFIG_KEY);
    if (s) {
        const d = JSON.parse(s);
        if (d.cols !== config.cols || d.rows !== config.rows || d.layoutMode !== config.layoutMode) {
            config = { ...config, ...d };
            updateStats();
            updateUI();
        }
    }
}, 1000);

// --- UPDATE GENÉRICO ---
const change = (key, val, showMsg = false) => {
    config[key] = val;
    if (key === 'targetCount' || key === 'layoutMode') calculateEstimatedGrid();
    saveConfig(config);
    updateUI();
    updateStats();

    if (key === 'exportWidth' || key === 'exportHeight') {
        if (val && val < 100) showToast('Para souvenirs, use pelo menos ~300px.', 'error');
    }
    if (['cols', 'rows', 'targetCount', 'layoutMode'].includes(key)) {
        const cap = (config.cols || 0) * (config.rows || 0);
        const target = config.targetCount || 0;
        if (cap && target && cap < target) showToast('Capacidade menor que o alvo.', 'error');
    }
    if (showMsg) showToast("Salvo");
};

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

    const hidden = (typeof getHiddenImages === 'function') ? getHiddenImages() : [];
    const hiddenSet = new Set(hidden);

    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    container.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    container.style.overflow = 'hidden';
    container.style.gap = '1px';
    container.style.backgroundColor = '#111827';

    if (config.backgroundUrl) {
        container.style.backgroundImage = `url('${config.backgroundUrl}')`;
        container.style.backgroundSize = 'cover';
        container.style.backgroundPosition = 'center';
        const b = config.bgBrightness ?? 100;
        const c = config.bgContrast ?? 100;
        const s = config.bgSaturate ?? 100;
        const bl = (config.bgBlur ?? 0) / 2;
        container.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) blur(${bl}px)`;
    } else {
        container.style.backgroundImage = 'none';
        container.style.filter = 'none';
    }

    let usedCount = 0;

    for (let i = 0; i < totalSlots; i++) {
        const id = gridState[i] || null;
        const cell = document.createElement('div');

        cell.style.position = 'relative';
        cell.style.overflow = 'hidden';
        cell.style.border = '1px solid rgba(255,255,255,0.1)';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';

        if (id) {
            usedCount++;
            const imgData = allImagesMap.get(id);
            if (imgData) {
                const img = document.createElement('img');
                img.src = imgData.url;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.display = 'block';
                img.style.opacity = config.opacity || 1;
                cell.appendChild(img);
            } else {
                cell.style.backgroundColor = 'rgba(22, 163, 74, 0.5)';
            }

            if (hiddenSet.has(id)) {
                const overlay = document.createElement('div');
                overlay.className = 'absolute inset-0 bg-red-900/80 flex items-center justify-center text-white text-[10px] font-bold z-10';
                overlay.textContent = 'BLOQ';
                cell.appendChild(overlay);
            }
        } else {
            cell.style.backgroundColor = 'rgba(0,0,0,0.2)';
        }

        if (config.showGridNumber) {
            const num = document.createElement('span');
            num.className = 'absolute top-0 left-0 p-0.5 text-[8px] text-white font-mono bg-black/50 z-20';
            num.textContent = i + 1;
            cell.appendChild(num);
        }
        container.appendChild(cell);
    }

    if (els.gridPreviewLabel) {
        const freeCount = totalSlots - usedCount;
        els.gridPreviewLabel.textContent = `${cols}x${rows} • Slots: ${totalSlots} • Ocupados: ${usedCount} • Livres: ${freeCount}`;
    }
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
        els.slotsFree.className = free === 0 ? "font-bold text-2xl text-red-500" : "font-bold text-2xl text-green-400";
    }
    if (els.slotsTotal) els.slotsTotal.textContent = cap;
    if (els.queueCount) els.queueCount.textContent = queue;
    if (els.statBackend && overrideTotal !== null) els.statBackend.textContent = overrideTotal;

    renderGridPreview();
}

function updateUI() {
    const els = getEls();
    document.body.dataset.mode = config.adminMode || 'setup';

    // Inputs
    if (els.targetCount) els.targetCount.value = config.targetCount || 20;
    if (els.layoutMode) els.layoutMode.value = config.layoutMode || 'target';
    if (els.gridCols) els.gridCols.value = config.cols;
    if (els.gridRows) els.gridRows.value = config.rows;
    if (els.gapIn) els.gapIn.value = config.gap;
    if (els.gapVal) els.gapVal.textContent = config.gap + 'px';
    if (els.opacityIn) els.opacityIn.value = (config.opacity || 1) * 100;
    if (els.opacityVal) els.opacityVal.textContent = Math.round((config.opacity || 1) * 100) + '%';

    // Bg
    if (els.bgBrightness) els.bgBrightness.value = config.bgBrightness;
    if (els.bgBrightnessVal) els.bgBrightnessVal.textContent = config.bgBrightness + '%';
    if (els.bgContrast) els.bgContrast.value = config.bgContrast;
    if (els.bgContrastVal) els.bgContrastVal.textContent = config.bgContrast + '%';
    if (els.bgSaturate) els.bgSaturate.value = config.bgSaturate;
    if (els.bgSaturateVal) els.bgSaturateVal.textContent = config.bgSaturate + '%';
    if (els.bgBlur) els.bgBlur.value = config.bgBlur;
    if (els.bgBlurVal) els.bgBlurVal.textContent = config.bgBlur + 'px';
    if (els.overlayStrength) els.overlayStrength.value = config.overlayStrength;
    if (els.overlayStrengthVal) els.overlayStrengthVal.textContent = config.overlayStrength + '%';

    // Comportamento / Animação
    if (els.heroInterval) els.heroInterval.value = config.heroInterval;
    if (els.heroIntervalVal) els.heroIntervalVal.textContent = config.heroInterval + 's';
    if (els.idleTimeout) els.idleTimeout.value = config.idleTimeout;
    if (els.idleTimeoutVal) els.idleTimeoutVal.textContent = config.idleTimeout + 's';
    if (els.animType) els.animType.value = config.animType;
    if (els.animDur) els.animDur.value = config.animDuration;

    const processMs = (config.processInterval || 3000);
    const processSec = processMs / 1000;
    if (els.processInterval) els.processInterval.value = processSec;
    if (els.procVal) els.procVal.textContent = `${processSec}s`;

    if (els.randCheck) els.randCheck.checked = config.randomPosition;
    if (els.persistCheck) els.persistCheck.checked = config.persistGrid;
    if (els.heroCheck) els.heroCheck.checked = config.heroEnabled;
    if (els.idleCheck) els.idleCheck.checked = config.idleEnabled;
    if (els.removalCheck) els.removalCheck.checked = config.removalMode;
    if (els.tickerEnabled) els.tickerEnabled.checked = config.tickerEnabled;
    if (els.showGridNumCheck) els.showGridNumCheck.checked = config.showGridNumber;

    // 🟢 UI UPDATE: Entry Animation
    if (els.entryAnimation) els.entryAnimation.checked = config.entryAnimation;
    if (els.entryAnimationMini) els.entryAnimationMini.checked = config.entryAnimation;

    if (els.entryDuration) els.entryDuration.value = (config.entryDuration || 3000) / 1000;
    if (els.entryDurationVal) els.entryDurationVal.textContent = ((config.entryDuration || 3000) / 1000) + 's';

    if (els.entrySpeed) els.entrySpeed.value = (config.entryAnimSpeed || 500) / 1000;
    if (els.entrySpeedVal) els.entrySpeedVal.textContent = ((config.entryAnimSpeed || 500) / 1000) + 's';

    if (els.entryScale) els.entryScale.value = config.entryScale || 1.5;
    if (els.entryScaleVal) els.entryScaleVal.textContent = (config.entryScale || 1.5) + 'x';

    // Export
    if (els.exportCheck) els.exportCheck.checked = config.exportEnabled;
    if (els.exportW) els.exportW.value = config.exportWidth;
    if (els.exportH) els.exportH.value = config.exportHeight;
    if (els.exportWithBgCheck) els.exportWithBgCheck.checked = (config.exportWithBackground ?? true);

    if (els.logoUrl) els.logoUrl.value = config.logoUrl || '';
    if (els.logoPosition) els.logoPosition.value = config.logoPosition || 'top-right';
    if (els.tickerText) els.tickerText.value = config.tickerText || '';
    if (els.dropboxToken) els.dropboxToken.value = config.dropboxToken || '';
    if (els.dropboxFolder) els.dropboxFolder.value = config.dropboxFolder || '/';

    if (els.groupTarget) {
        els.groupTarget.classList.add('hidden');
        els.groupAuto?.classList.add('hidden');
        els.groupManual?.classList.add('hidden');
        if (config.layoutMode === 'target') els.groupTarget.classList.remove('hidden');
        else if (config.layoutMode === 'auto-fit') els.groupAuto?.classList.remove('hidden');
        else els.groupManual?.classList.remove('hidden');
    }

    // Buttons
    if (config.sourceMode === 'dropbox') {
        if (els.modeDropboxBtn) els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        if (els.modeLocalBtn) els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:text-white";
        els.dropboxSettings?.classList.remove('hidden');
        els.localSettings?.classList.add('hidden');
    } else {
        if (els.modeLocalBtn) els.modeLocalBtn.className = "flex-1 py-2 text-xs font-bold rounded transition bg-blue-600 text-white";
        if (els.modeDropboxBtn) els.modeDropboxBtn.className = "flex-1 py-2 text-xs font-bold rounded transition text-slate-400 hover:bg-slate-800 hover:text-white";
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
}

function setupListeners() {
    const els = getEls();

    if (els.previewGenerateBtn) {
        els.previewGenerateBtn.addEventListener('click', generatePreview);
    }

    // 🟢 LISTENERS QUE FALTAVAM PARA SALVAR AS CONFIGURAÇÕES
    if (els.entryDuration) {
        els.entryDuration.addEventListener('input', e => {
            const val = parseFloat(e.target.value) * 1000; // converte s para ms
            change('entryDuration', val);
        });
    }
    if (els.entrySpeed) {
        els.entrySpeed.addEventListener('input', e => {
            const val = parseFloat(e.target.value) * 1000; // converte s para ms
            change('entryAnimSpeed', val);
        });
    }
    if (els.entryScale) {
        els.entryScale.addEventListener('input', e => {
            change('entryScale', parseFloat(e.target.value));
        });
    }

    // Layout
    if (els.layoutMode) els.layoutMode.addEventListener('change', e => change('layoutMode', e.target.value, true));
    const numBind = (el, key) => el?.addEventListener('input', e => {
        const v = parseInt(e.target.value || '0', 10);
        if (!Number.isNaN(v)) change(key, v);
    });

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
    numBind(els.overlayStrength, 'overlayStrength');
    numBind(els.exportW, 'exportWidth');
    numBind(els.exportH, 'exportHeight');

    if (els.opacityIn) els.opacityIn.addEventListener('input', e => change('opacity', parseFloat(e.target.value) / 100));
    if (els.processInterval) els.processInterval.addEventListener('input', e => change('processInterval', parseFloat(e.target.value || '0') * 1000));

    const chkBind = (el, key) => el?.addEventListener('change', e => change(key, e.target.checked, true));
    chkBind(els.persistCheck, 'persistGrid');
    chkBind(els.removalCheck, 'removalMode');
    chkBind(els.heroCheck, 'heroEnabled');
    chkBind(els.idleCheck, 'idleEnabled');
    chkBind(els.tickerEnabled, 'tickerEnabled');
    chkBind(els.showGridNumCheck, 'showGridNumber');
    chkBind(els.exportCheck, 'exportEnabled');
    chkBind(els.exportWithBgCheck, 'exportWithBackground');

    // Sincroniza checkboxes de Entry Animation
    const entryChecks = [els.entryAnimation, els.entryAnimationMini].filter(Boolean);
    entryChecks.forEach(chk => {
        chk.addEventListener('change', (e) => {
            const checked = e.target.checked;
            change('entryAnimation', checked, true);
            entryChecks.forEach(other => { if (other) other.checked = checked; });
        });
    });

    // Sincroniza checkboxes de Random Position
    const randChecks = document.querySelectorAll('input#random-position');
    if (randChecks.length > 0) {
        randChecks.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const checked = e.target.checked;
                change('randomPosition', checked, true);
                randChecks.forEach(other => { if (other !== e.target) other.checked = checked; });
            });
        });
    }

    if (els.bgFileInput) {
        els.bgFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const formData = new FormData(); formData.append('background', file);
            els.bgStatus.textContent = "Enviando...";
            try {
                const res = await fetch('http://localhost:3000/api/upload-bg', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    change('backgroundUrl', data.url);
                    els.bgStatus.textContent = "Sucesso!";
                    showToast("Fundo Atualizado");
                } else els.bgStatus.textContent = "Erro.";
            } catch (err) { els.bgStatus.textContent = "Erro conexao."; }
        });
    }

    if (els.toggleBtn) els.toggleBtn.addEventListener('click', () => {
        change('processing', !config.processing);
        showToast(config.processing ? "Iniciado" : "Pausado");
    });

    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => { fetchGallery(); showToast("Lista Atualizada"); });
    if (els.clearHiddenBtn) els.clearHiddenBtn.addEventListener('click', () => { clearHiddenImages(); fetchGallery(); showToast("Bloqueios Limpos"); });

    const setTab = (tab) => { currentFilter = tab; updateUI(); fetchGallery(); };
    if (els.tabQueue) els.tabQueue.addEventListener('click', () => setTab('queue'));
    if (els.tabWall) els.tabWall.addEventListener('click', () => setTab('wall'));
    if (els.tabRemoved) els.tabRemoved.addEventListener('click', () => setTab('removed'));

    // ... (listeners de wizard e backup omitidos para brevidade, mas devem estar aqui se você usar) ...
}

async function fetchGallery() {
    const source = config.sourceMode || 'local';
    let url = `http://localhost:3000/api/images?source=${source}`;
    if (source === 'dropbox') url += `&token=${config.dropboxToken}&folderPath=${config.dropboxFolder}`;
    try {
        const res = await fetch(url);
        const images = await res.json();

        allImagesMap.clear();
        images.forEach(img => allImagesMap.set(img.id, img));

        if (Array.isArray(images)) {
            images.sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return ta - tb;
            });
            for (const img of images) {
                if (img.id && !lastImageIds.has(img.id)) lastImageIds.add(img.id);
            }
        }

        renderGallery(images);
        updateStats(images.length);
    } catch (e) { }
}

function renderGallery(images) {
    const els = getEls(); if (!els.gallery) return;
    const gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    const usedIds = new Set(gs.filter(id => id));
    const hiddenIds = getHiddenImages();

    let displayImages = [];
    if (currentFilter === 'queue') displayImages = images.filter(img => !usedIds.has(img.id) && !hiddenIds.includes(img.id));
    else if (currentFilter === 'wall') displayImages = images.filter(img => usedIds.has(img.id));
    else if (currentFilter === 'removed') displayImages = images.filter(img => hiddenIds.includes(img.id));

    els.gallery.innerHTML = '';
    if (displayImages.length === 0) {
        els.gallery.innerHTML = `<p class="col-span-full text-center py-4 text-slate-500">Vazio</p>`;
        return;
    }

    displayImages.forEach(img => {
        const isOnWall = usedIds.has(img.id);
        const isHidden = hiddenIds.includes(img.id);
        let border = isOnWall ? 'border-green-500 border-2' : isHidden ? 'border-red-900 border-2 opacity-40' : 'border-blue-500/30 border-2';

        const div = document.createElement('div');
        div.className = `aspect-square bg-slate-800 rounded-lg relative overflow-hidden group border ${border}`;
        div.innerHTML = `
            <img src="${img.url}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/80 hidden group-hover:flex flex-col items-center justify-center gap-2 transition-all backdrop-blur-sm">
                ${isOnWall
                ? `<button onclick="actRem('${img.id}')" class="bg-red-600 text-white text-[10px] px-3 py-1 rounded">Remover</button>`
                : isHidden
                    ? `<button onclick="actRes('${img.id}')" class="bg-slate-500 text-white text-[10px] px-3 py-1 rounded">Restaurar</button>`
                    : `<button onclick="actBlk('${img.id}')" class="bg-red-900 text-white text-[10px] px-3 py-1 rounded">Bloquear</button>`
            }
            </div>
        `;
        els.gallery.appendChild(div);
    });
}

window.actRem = (id) => { addHiddenImage(id); saveConfig(config); fetchGallery(); };
window.actBlk = (id) => { addHiddenImage(id); saveConfig(config); fetchGallery(); };
window.actRes = (id) => {
    let h = getHiddenImages().filter(x => x !== id);
    localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(h));
    fetchGallery();
};

async function checkServerHealth() {
    try {
        const res = await fetch('http://localhost:3000/health');
        updateServerStatus(res.ok);
    } catch (e) {
        updateServerStatus(false);
    }
}

function initStatusMonitor() {
    const logEl = document.getElementById('status-log');

    const es = new EventSource('http://localhost:3000/events');

    es.onopen = () => {
        updateServerStatus(true);
    };

    es.onerror = () => {
        updateServerStatus(false);
    };

    es.onmessage = (e) => {
        try {
            const d = JSON.parse(e.data);

            if (logEl) {
                const div = document.createElement('div');
                div.className = d.type === 'error' ? 'text-red-400' : 'text-slate-300';
                div.innerText = `[${d.time}] ${d.msg}`;
                logEl.appendChild(div);
                logEl.scrollTop = logEl.scrollHeight;
            }

            if (d.type === 'error') {
                updateServerStatus(false);
            }
        } catch (err) {
            console.error('Erro ao processar evento SSE:', err);
        }
    };
}


async function bootAdmin() {
    await restoreStateFromServer();
    config = loadConfig();
    initStatusMonitor();
    checkServerHealth();
    setInterval(checkServerHealth, 15000);
    updateUI();
    setupListeners();
    setInterval(fetchGallery, 3000);
    fetchGallery();
}

bootAdmin();
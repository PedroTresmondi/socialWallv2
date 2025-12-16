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

config.entryFlyToSlot = config.entryFlyToSlot ?? false;
config.entryBorderWidth = config.entryBorderWidth ?? 2;
config.entryBorderOpacity = config.entryBorderOpacity ?? 18;
config.entryBorderRadius = config.entryBorderRadius ?? 14;

config.entryFlyCenterScale = config.entryFlyCenterScale ?? 1.8;

config.eventName = config.eventName || '';
config.screenWidth = config.screenWidth || 1920;
config.screenHeight = config.screenHeight || 1080;
config.exportBaseFolder = config.exportBaseFolder || '';
config.adminMode = config.adminMode || 'setup';

// ✅ default do toggle “exportar com background”
config.exportWithBackground = config.exportWithBackground ?? true;

// ✅ default do modo de fonte
config.sourceMode = config.sourceMode || 'local';

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
    layoutLockCheck: document.getElementById('layout-lock'),
    captureWallBtn: document.getElementById('capture-wall-btn'),

    captureWallAdminBtn: document.getElementById('capture-wall-admin-btn'),

    entryFlyCenterScale: document.getElementById('entry-fly-center-scale'),
    entryFlyCenterScaleVal: document.getElementById('entry-fly-center-scale-val'),

    // Search + Resumo ativo
    adminSearch: document.getElementById('admin-search'),
    activeSummaryCard: document.getElementById('active-summary-card'),
    activeSummaryBody: document.getElementById('active-summary-body'),

    // Random mini (ID corrigido no HTML)
    randCheckMini: document.getElementById('random-position-mini'),

    // Subtabs de comportamento (HTML novo)
    behaviorTabButtons: document.querySelectorAll('[data-behavior-tab-btn]'),
    behaviorTabPanels: document.querySelectorAll('[data-behavior-tab-panel]'),

    // Botões “Testar efeito”
    testEntryBtn: document.getElementById('test-entry-btn'),
    testFlyBtn: document.getElementById('test-fly-btn'),
    testHeroBtn: document.getElementById('test-hero-btn'),

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
    entryDuration: document.getElementById('entry-duration'),
    entrySpeed: document.getElementById('entry-speed'),
    entryScale: document.getElementById('entry-scale'),
    entryFlyToSlot: document.getElementById('entry-fly-to-slot'),
    entryFlyToSlotMini: document.getElementById('entry-fly-to-slot-mini'),
    entryBorderWidth: document.getElementById('entry-border-width'),
    entryBorderOpacity: document.getElementById('entry-border-opacity'),
    entryBorderRadius: document.getElementById('entry-border-radius'),

    // Labels
    entryDurationVal: document.getElementById('entry-duration-val'),
    entrySpeedVal: document.getElementById('entry-speed-val'),
    entryScaleVal: document.getElementById('entry-scale-val'),
    entryBorderWidthVal: document.getElementById('entry-border-width-val'),
    entryBorderOpacityVal: document.getElementById('entry-border-opacity-val'),
    entryBorderRadiusVal: document.getElementById('entry-border-radius-val'),

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
    gridPreviewWrapper: document.getElementById('grid-preview-wrapper'),
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

// --- ACCORDIONS (MELHORIA DE USABILIDADE) ---
function initAccordions() {
    document.querySelectorAll('.glass-panel h3').forEach(header => {
        if (!header.dataset.accordion) {
            header.dataset.accordion = "true";
            header.style.cursor = 'pointer';
            header.title = "Clique para minimizar/expandir";
            header.innerHTML = `<span class="mr-2">▼</span> ${header.innerHTML}`;

            header.addEventListener('click', () => {
                const parent = header.parentElement;
                const children = Array.from(parent.children).filter(c => c !== header);
                const isClosed = parent.getAttribute('data-closed') === 'true';

                children.forEach(el => el.style.display = isClosed ? '' : 'none');
                parent.setAttribute('data-closed', !isClosed);
                header.querySelector('span').innerText = isClosed ? '▼' : '▶';
            });
        }
    });
}

function updateServerStatus(isOnline) {
    const els = getEls();
    const badge = els.serverStatusBadge;
    if (!badge) return;

    const dot = badge.querySelector('.status-dot');
    const label = badge.querySelector('.status-label');

    badge.classList.remove(
        'bg-red-900/60', 'text-red-200', 'border-red-500/60',
        'bg-emerald-900/60', 'text-emerald-200', 'border-emerald-500/60'
    );

    if (isOnline) {
        badge.classList.add('bg-emerald-900/60', 'text-emerald-200', 'border-emerald-500/60');
        if (dot) {
            dot.classList.remove('bg-red-400');
            dot.classList.add('bg-emerald-400');
        }
        if (label) label.textContent = 'Servidor ON';
    } else {
        badge.classList.add('bg-red-900/60', 'text-red-200', 'border-red-500/60');
        if (dot) {
            dot.classList.remove('bg-emerald-400');
            dot.classList.add('bg-red-400');
        }
        if (label) label.textContent = 'Servidor OFF';
    }
}

function initAdminBroadcastHandlers() {
    if (!syncChannel) return;

    syncChannel.addEventListener('message', (event) => {
        const msg = event.data || {};
        if (msg.type === 'CAPTURE_WALL_DONE') {
            const url = msg.data && msg.data.url;
            if (url) {
                showToast('Mural capturado com sucesso! Arquivo salvo em ' + url);
                console.log('[Admin] Snapshot do mural em:', url);
            } else {
                showToast('Mural capturado com sucesso.', 'success');
            }
        }

        if (msg.type === 'CAPTURE_WALL_ERROR') {
            const message = (msg.data && msg.data.message) || 'Erro desconhecido ao capturar mural.';
            showToast(message, 'error');
        }
    });
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

        const withBg = (config.exportWithBackground ?? true);

        const exportData = {
            photoId: latestImage.id,

            // ✅ passa o toggle pro servidor (se ele quiser usar)
            exportWithBackground: withBg,

            // Se desligar o BG, mandamos backgroundUrl null pra forçar “somente a foto”
            backgroundUrl: withBg ? config.backgroundUrl : null,

            tile: { row: 0, col: 0, cols, rows },
            slotCoords: slotCoords,
            exportSize: {
                w: config.exportWidth || 300,
                h: config.exportHeight || 300
            },

            // Opacidade vem em 0..1 (igual admin)
            opacity: config.opacity || 1,

            gridNumber: config.showGridNumber ? 1 : null,

            // Se desligar BG, pode ignorar filtros/overlay
            bgFilters: withBg ? {
                brightness: config.bgBrightness ?? 100,
                contrast: config.bgContrast ?? 100,
                saturate: config.bgSaturate ?? 100,
                blur: config.bgBlur ?? 0
            } : null,

            overlayStrength: withBg ? (config.overlayStrength ?? 100) : 0
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
    if (config.layoutLocked) return;

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

    const screenW = config.screenWidth || 1920;
    const screenH = config.screenHeight || 1080;

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
        els.gridPreviewLabel.textContent = `${cols}x${rows} • Slots: ${totalSlots} • Ocupados: ${usedCount} • Livres: ${freeCount} • Resolução: ${screenW}x${screenH}`;
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

    // Inputs (Sincronização Bidirecional)
    if (els.targetCount) els.targetCount.value = config.targetCount || 20;
    if (els.layoutMode) els.layoutMode.value = config.layoutMode || 'target';
    if (els.gridCols) els.gridCols.value = config.cols;
    if (els.gridRows) els.gridRows.value = config.rows;
    if (els.gapIn) els.gapIn.value = config.gap;
    if (els.gapVal) els.gapVal.textContent = config.gap + 'px';
    if (els.opacityIn) els.opacityIn.value = (config.opacity || 1) * 100;
    if (els.opacityVal) els.opacityVal.textContent = Math.round((config.opacity || 1) * 100) + '%';

    if (els.layoutMode) els.layoutMode.value = config.layoutMode || 'target';
    if (els.layoutLockCheck) els.layoutLockCheck.checked = !!config.layoutLocked;

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

    // Comportamento
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

    // Entry Animation UI
    if (els.entryAnimation) els.entryAnimation.checked = config.entryAnimation;
    if (els.entryAnimationMini) els.entryAnimationMini.checked = config.entryAnimation;
    if (els.entryDuration) els.entryDuration.value = (config.entryDuration || 3000) / 1000;
    if (els.entryDurationVal) els.entryDurationVal.textContent = ((config.entryDuration || 3000) / 1000) + 's';
    if (els.entrySpeed) els.entrySpeed.value = (config.entryAnimSpeed || 500) / 1000;
    if (els.entrySpeedVal) els.entrySpeedVal.textContent = ((config.entryAnimSpeed || 500) / 1000) + 's';
    if (els.entryScale) els.entryScale.value = config.entryScale || 1.5;
    if (els.entryScaleVal) els.entryScaleVal.textContent = (config.entryScale || 1.5) + 'x';

    // Fly & Border UI
    if (els.entryFlyToSlot) els.entryFlyToSlot.checked = !!config.entryFlyToSlot;
    if (els.entryFlyToSlotMini) els.entryFlyToSlotMini.checked = !!config.entryFlyToSlot;
    if (els.entryBorderWidth) els.entryBorderWidth.value = (config.entryBorderWidth ?? 2);
    if (els.entryBorderWidthVal) els.entryBorderWidthVal.textContent = (config.entryBorderWidth ?? 2) + 'px';
    if (els.entryBorderOpacity) els.entryBorderOpacity.value = (config.entryBorderOpacity ?? 18);
    if (els.entryBorderOpacityVal) els.entryBorderOpacityVal.textContent = (config.entryBorderOpacity ?? 18) + '%';
    if (els.entryBorderRadius) els.entryBorderRadius.value = (config.entryBorderRadius ?? 14);
    if (els.entryBorderRadiusVal) els.entryBorderRadiusVal.textContent = (config.entryBorderRadius ?? 14) + 'px';

    // Export UI
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

    // Botões de Modo
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
    updateActiveSummaryCard();
}

async function startDropboxMonitor() {
    const token = config.dropboxToken;
    const folder = config.dropboxFolder;

    if (!token) {
        showToast('Informe o Access Token do Dropbox antes de sincronizar.', 'error');
        return;
    }

    try {
        const res = await fetch('http://localhost:3000/api/dropbox/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                folder
            })
        });

        if (!res.ok) {
            throw new Error('Resposta HTTP não OK');
        }

        const data = await res.json();
        if (data && data.success) {
            showToast('Monitor Dropbox iniciado com sucesso.');
        } else {
            showToast('Não foi possível iniciar o monitor do Dropbox.', 'error');
        }
    } catch (err) {
        console.error('Erro ao iniciar monitor Dropbox:', err);
        showToast('Erro ao iniciar monitor do Dropbox.', 'error');
    }
    updateActiveSummaryCard();
}

function requestWallSnapshotFromAdmin() {
    try {
        if (!syncChannel) {
            showToast('Canal de sincronização não disponível.', 'error');
            return;
        }

        syncChannel.postMessage({ type: 'CAPTURE_WALL' });
        showToast('Pedido de captura enviado para o mural.');
    } catch (e) {
        console.error('[Admin] Erro ao enviar CAPTURE_WALL:', e);
        showToast('Erro ao enviar pedido de captura.', 'error');
    }
}

function normalizeSearch(str) {
    return (str || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function initAdminSearch() {
    const els = getEls();
    const input = els.adminSearch;
    if (!input) return;

    const cards = Array.from(document.querySelectorAll('[data-admin-card="1"]'));
    const apply = () => {
        const q = normalizeSearch(input.value);
        if (!q) {
            cards.forEach(c => c.classList.remove('hidden'));
            return;
        }

        cards.forEach(card => {
            const hay = normalizeSearch(card.getAttribute('data-search-text') || card.textContent);
            const hit = hay.includes(q);
            card.classList.toggle('hidden', !hit);
        });
    };

    input.addEventListener('input', apply);
    apply();
}

function formatBool(v) {
    return v ? 'ON' : 'OFF';
}

function updateActiveSummaryCard() {
    const els = getEls();
    if (!els.activeSummaryBody) return;

    const cols = config.cols || 1;
    const rows = config.rows || 1;
    const cap = cols * rows;

    const layout = config.layoutMode || 'target';
    const gap = (config.gap ?? 0) + 'px';
    const opacityPct = Math.round((config.opacity || 1) * 100) + '%';

    const fly = formatBool(!!config.entryFlyToSlot);
    const hero = formatBool(!!config.heroEnabled);
    const entry = formatBool(!!config.entryAnimation);
    const exportOn = formatBool(!!config.exportEnabled);
    const exportBg = formatBool(!!(config.exportWithBackground ?? true));

    const screenW = config.screenWidth || 1920;
    const screenH = config.screenHeight || 1080;

    els.activeSummaryBody.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Layout</div>
                <div class="text-slate-100 font-semibold">${layout}</div>
            </div>
            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Grid</div>
                <div class="text-slate-100 font-semibold">${cols} x ${rows} (${cap}) • gap ${gap}</div>
            </div>
            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Tela</div>
                <div class="text-slate-100 font-semibold">${screenW} x ${screenH}</div>
            </div>
            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Opacidade</div>
                <div class="text-slate-100 font-semibold">${opacityPct}</div>
            </div>

            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Fly</div>
                <div class="text-slate-100 font-semibold">${fly}</div>
            </div>
            <div class="bg-slate-900/40 border border-slate-700 rounded p-2">
                <div class="text-[9px] text-slate-400 uppercase">Hero</div>
                <div class="text-slate-100 font-semibold">${hero} • entrada ${entry}</div>
            </div>

            <div class="bg-slate-900/40 border border-slate-700 rounded p-2 col-span-2">
                <div class="text-[9px] text-slate-400 uppercase">Export</div>
                <div class="text-slate-100 font-semibold">
                    ${exportOn} • ${config.exportWidth || 300}x${config.exportHeight || 300} • com bg ${exportBg}
                </div>
            </div>
        </div>
    `;
}

function initBehaviorSubtabs() {
    const els = getEls();
    const btns = Array.from(els.behaviorTabButtons || []);
    const panels = Array.from(els.behaviorTabPanels || []);
    if (!btns.length || !panels.length) return;

    const KEY = 'adminBehaviorTab';
    const setActive = (tab) => {
        btns.forEach(b => {
            const isActive = b.getAttribute('data-behavior-tab-btn') === tab;
            b.classList.toggle('bg-indigo-600', isActive);
            b.classList.toggle('text-white', isActive);
            b.classList.toggle('bg-slate-900/70', !isActive);
            b.classList.toggle('text-slate-200', !isActive);
        });

        panels.forEach(p => {
            const isActive = p.getAttribute('data-behavior-tab-panel') === tab;
            p.classList.toggle('hidden', !isActive);
        });

        localStorage.setItem(KEY, tab);
    };

    btns.forEach(b => b.addEventListener('click', () => {
        setActive(b.getAttribute('data-behavior-tab-btn'));
    }));

    const initial = localStorage.getItem(KEY) || btns[0].getAttribute('data-behavior-tab-btn');
    setActive(initial);
}

function getDummyTestImageDataUrl() {
    const svg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
          <defs>
            <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#60a5fa"/>
              <stop offset="1" stop-color="#f472b6"/>
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
                font-family="Inter, Arial" font-size="48" fill="white" opacity="0.9">
            TESTE EFEITO
          </text>
        </svg>
    `);
    return `data:image/svg+xml;charset=utf-8,${svg}`;
}

function getBestTestImageUrl() {
    let last = null;
    try {
        for (const v of allImagesMap.values()) last = v;
    } catch { }
    return (last && last.url) ? last.url : getDummyTestImageDataUrl();
}

function requestTestEffect(effect) {
    if (!syncChannel) {
        showToast('Canal de sincronização não disponível (syncChannel).', 'error');
        return;
    }

    const url = getBestTestImageUrl();

    syncChannel.postMessage({
        type: 'TEST_EFFECT',
        data: {
            effect,
            url,
            configSnapshot: {
                entryFlyToSlot: !!config.entryFlyToSlot,
                entryAnimSpeed: config.entryAnimSpeed,
                entryDuration: config.entryDuration,
                entryScale: config.entryScale,
                entryBorderWidth: config.entryBorderWidth,
                entryBorderOpacity: config.entryBorderOpacity,
                entryBorderRadius: config.entryBorderRadius,
                entryFlyCenterScale: config.entryFlyCenterScale
            }
        }
    });

    showToast(`Teste enviado: ${effect.toUpperCase()}`);
}

function setupListeners() {
    initBehaviorSubtabs();

    const els = getEls();

    if (els.testEntryBtn) els.testEntryBtn.addEventListener('click', () => requestTestEffect('entry'));
    if (els.testFlyBtn) els.testFlyBtn.addEventListener('click', () => requestTestEffect('fly'));
    if (els.testHeroBtn) els.testHeroBtn.addEventListener('click', () => requestTestEffect('hero'));

    if (els.previewGenerateBtn) {
        els.previewGenerateBtn.addEventListener('click', generatePreview);
    }

    if (els.captureWallAdminBtn) {
        els.captureWallAdminBtn.addEventListener('click', requestWallSnapshotFromAdmin);
    }

    if (els.layoutMode) els.layoutMode.addEventListener('change', e => change('layoutMode', e.target.value, true));
    const numBind = (el, key) => el?.addEventListener('input', e => {
        const v = parseInt(e.target.value || '0', 10);
        if (Number.isNaN(v)) return;
        change(key, v);
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

    if (els.opacityIn)
        els.opacityIn.addEventListener('input', e => change('opacity', parseFloat(e.target.value) / 100));

    if (els.animType)
        els.animType.addEventListener('change', e => change('animType', e.target.value));

    if (els.animDur)
        els.animDur.addEventListener('input', e => {
            const v = parseInt(e.target.value || '0', 10);
            if (!Number.isNaN(v)) change('animDuration', v);
        });

    if (els.processInterval)
        els.processInterval.addEventListener('input', e => {
            const v = parseFloat(e.target.value || '0');
            if (!Number.isNaN(v)) change('processInterval', v * 1000);
        });

    // --- Entry controls (separados pra não dependerem de entryScale existir) ---
    if (els.entryDuration) {
        els.entryDuration.addEventListener('input', e => {
            const seconds = parseFloat(e.target.value || '0');
            if (!Number.isNaN(seconds)) change('entryDuration', seconds * 1000);
        });
    }

    if (els.entrySpeed) {
        els.entrySpeed.addEventListener('input', e => {
            const seconds = parseFloat(e.target.value || '0');
            if (!Number.isNaN(seconds)) change('entryAnimSpeed', seconds * 1000);
        });
    }

    if (els.entryScale) {
        els.entryScale.addEventListener('input', e => {
            const scale = parseFloat(e.target.value || '0');
            if (!Number.isNaN(scale)) change('entryScale', scale);
        });
    }

    const flyChecks = [els.entryFlyToSlot, els.entryFlyToSlotMini].filter(Boolean);
    if (flyChecks.length > 0) {
        flyChecks.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const checked = e.target.checked;
                change('entryFlyToSlot', checked, true);
                flyChecks.forEach(other => {
                    if (other && other !== e.target) other.checked = checked;
                });
            });
        });
    }

    if (els.entryBorderWidth) {
        els.entryBorderWidth.addEventListener('input', e => {
            const v = parseInt(e.target.value || '0', 10);
            if (!Number.isNaN(v)) change('entryBorderWidth', v);
        });
    }

    if (els.entryBorderOpacity) {
        els.entryBorderOpacity.addEventListener('input', e => {
            const v = parseInt(e.target.value || '0', 10);
            if (!Number.isNaN(v)) change('entryBorderOpacity', v);
        });
    }

    if (els.entryBorderRadius) {
        els.entryBorderRadius.addEventListener('input', e => {
            const v = parseInt(e.target.value || '0', 10);
            if (!Number.isNaN(v)) change('entryBorderRadius', v);
        });
    }

    if (els.entryFlyCenterScale) {
        const apply = () => {
            const v = parseFloat(els.entryFlyCenterScale.value || '1.8');
            if (els.entryFlyCenterScaleVal) els.entryFlyCenterScaleVal.textContent = `${v.toFixed(1)}x`;
            change('entryFlyCenterScale', v);
        };
        els.entryFlyCenterScale.addEventListener('input', apply);
        apply();
    }

    const chkBind = (el, key) => el?.addEventListener('change', e => change(key, e.target.checked, true));
    chkBind(els.persistCheck, 'persistGrid');
    chkBind(els.removalCheck, 'removalMode');
    chkBind(els.heroCheck, 'heroEnabled');
    chkBind(els.idleCheck, 'idleEnabled');
    chkBind(els.tickerEnabled, 'tickerEnabled');
    chkBind(els.showGridNumCheck, 'showGridNumber');
    chkBind(els.exportCheck, 'exportEnabled');
    chkBind(els.exportWithBgCheck, 'exportWithBackground');
    chkBind(els.layoutLockCheck, 'layoutLocked');

    const entryChecks = [els.entryAnimation, els.entryAnimationMini].filter(Boolean);
    if (entryChecks.length > 0) {
        entryChecks.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const checked = e.target.checked;
                change('entryAnimation', checked, true);
                entryChecks.forEach(other => {
                    if (other && other !== e.target) other.checked = checked;
                });
            });
        });
    }

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
            config.sourceMode = 'dropbox';
            saveConfig(config);
            updateUI();
            startDropboxMonitor();
            fetchGallery();
            showToast("Modo Dropbox");
        });

    if (els.modeLocalBtn)
        els.modeLocalBtn.addEventListener('click', () => {
            config.sourceMode = 'local';
            saveConfig(config);
            updateUI();
            fetchGallery();
            showToast("Modo Local");
        });

    if (els.dropboxSyncBtn)
        els.dropboxSyncBtn.addEventListener('click', () => {
            config.dropboxToken = els.dropboxToken.value;
            config.dropboxFolder = els.dropboxFolder.value || '/';
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

    const setTab = (tab) => { currentFilter = tab; updateUI(); fetchGallery(); };
    if (els.tabQueue) els.tabQueue.addEventListener('click', () => setTab('queue'));
    if (els.tabWall) els.tabWall.addEventListener('click', () => setTab('wall'));
    if (els.tabRemoved) els.tabRemoved.addEventListener('click', () => setTab('removed'));

    if (els.wizardEventNameInput)
        els.wizardEventNameInput.addEventListener('input', e => change('eventName', e.target.value));

    if (els.screenWidth)
        els.screenWidth.addEventListener('input', e => change('screenWidth', parseInt(e.target.value || '0') || 0));

    if (els.screenHeight)
        els.screenHeight.addEventListener('input', e => change('screenHeight', parseInt(e.target.value || '0') || 0));

    if (els.screenPreset1080p)
        els.screenPreset1080p.addEventListener('click', () => {
            change('screenWidth', 1920);
            change('screenHeight', 1080, true);
        });

    if (els.screenPreset4k)
        els.screenPreset4k.addEventListener('click', () => {
            change('screenWidth', 3840);
            change('screenHeight', 2160, true);
        });

    if (els.screenPresetCustom)
        els.screenPresetCustom.addEventListener('click', () => {
            const w = parseInt(els.screenWidth?.value || '0') || 0;
            const h = parseInt(els.screenHeight?.value || '0') || 0;
            if (!w || !h) {
                showToast('Preencha largura e altura personalizadas.', 'error');
            } else {
                change('screenWidth', w);
                change('screenHeight', h, true);
            }
        });

    if (els.wizardLayoutTargetBtn)
        els.wizardLayoutTargetBtn.addEventListener('click', () => change('layoutMode', 'target', true));
    if (els.wizardLayoutAutoFitBtn)
        els.wizardLayoutAutoFitBtn.addEventListener('click', () => change('layoutMode', 'auto-fit', true));
    if (els.wizardLayoutManualBtn)
        els.wizardLayoutManualBtn.addEventListener('click', () => change('layoutMode', 'manual', true));

    if (els.wizardExportBaseFolder)
        els.wizardExportBaseFolder.addEventListener('input', e => change('exportBaseFolder', e.target.value));

    const goToStep = (step) => {
        wizardCurrentStep = Math.min(4, Math.max(1, step));
        // updateWizardStepUI(); // Se não existir, comente ou implemente
    };
    if (els.wizardStep1Btn) els.wizardStep1Btn.addEventListener('click', () => goToStep(1));
    if (els.wizardStep2Btn) els.wizardStep2Btn.addEventListener('click', () => goToStep(2));
    if (els.wizardStep3Btn) els.wizardStep3Btn.addEventListener('click', () => goToStep(3));
    if (els.wizardStep4Btn) els.wizardStep4Btn.addEventListener('click', () => goToStep(4));

    if (els.wizardPrev)
        els.wizardPrev.addEventListener('click', () => goToStep(wizardCurrentStep - 1));
    if (els.wizardNext)
        els.wizardNext.addEventListener('click', () => goToStep(wizardCurrentStep + 1));

    const randChecks = [els.randCheck, els.randCheckMini].filter(Boolean);
    if (randChecks.length) {
        randChecks.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const checked = !!e.target.checked;
                change('randomPosition', checked, true);
                randChecks.forEach(other => {
                    if (other && other !== e.target) other.checked = checked;
                });
            });
        });
    }

    if (els.sectionNavBtns && els.sectionNavBtns.forEach) {
        Array.from(els.sectionNavBtns).forEach(btn => {
            btn.addEventListener('click', () => {
                const targetSel = btn.getAttribute('data-target');
                if (!targetSel) return;
                const target = document.querySelector(targetSel);
                if (!target) return;
                const headerOffset = 80;
                const rect = target.getBoundingClientRect();
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                window.scrollTo({
                    top: rect.top + scrollTop - headerOffset,
                    behavior: 'smooth'
                });
            });
        });
    }

    if (els.modeSetupBtn)
        els.modeSetupBtn.addEventListener('click', () => {
            config.adminMode = 'setup';
            saveConfig(config);
            updateUI();
            showToast('Modo Setup ativado');
        });

    if (els.modeLiveBtn)
        els.modeLiveBtn.addEventListener('click', () => {
            config.adminMode = 'live';
            saveConfig(config);
            updateUI();
            showToast('Modo Operação ativado');
        });

    if (els.configDownloadBtn)
        els.configDownloadBtn.addEventListener('click', () => {
            try {
                const dataStr = JSON.stringify(config, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'socialwall-config.json';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 0);
                showToast('Configuração exportada.');
            } catch {
                showToast('Erro ao gerar arquivo de configuração.', 'error');
            }
        });

    if (els.configUploadInput)
        els.configUploadInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const txt = ev.target.result;
                    const parsed = JSON.parse(txt);
                    if (!parsed || typeof parsed !== 'object') {
                        showToast('Arquivo inválido.', 'error');
                        return;
                    }
                    config = { ...config, ...parsed };
                    saveConfig(config);
                    updateUI();
                    updateStats();
                    showToast('Configuração aplicada com sucesso.');
                } catch {
                    showToast('Erro ao ler config.json. Verifique o arquivo.', 'error');
                } finally {
                    e.target.value = '';
                }
            };
            reader.readAsText(file, 'utf-8');
        });

    if (els.statusLogClearBtn)
        els.statusLogClearBtn.addEventListener('click', () => {
            const log = els.statusLog;
            if (log) log.innerHTML = '';
            errorCount = 0;
            if (els.statusErrorCounter) els.statusErrorCounter.textContent = 'Erros: 0';
            if (els.statusLastError) {
                els.statusLastError.textContent = '';
                els.statusLastError.classList.add('hidden');
            }
        });

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
            if (!confirm('Remover exports antigos (mais de 1 dia)?\n\nIsso NÃO remove as fotos originais, apenas os arquivos de souvenir já gerados.'))
                return;
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
            if (!confirm(
                'Tem certeza que deseja resetar o evento?\n\nIsso irá:\n• Limpar layout atual (cols/rows, gaps etc.)\n• Limpar estado local do grid\n• Limpar bloqueios locais (lixeira)\n\nAs fotos originais e exports já gerados NÃO serão apagados.'
            )) return;
            try {
                const res = await fetch('http://localhost:3000/api/reset-event', {
                    method: 'POST'
                });
                if (!res.ok) throw new Error('Erro HTTP');

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

// --- RENDER GALLERY (Versão Otimizada com Diff Simples) ---
function renderGallery(images) {
    const els = getEls();
    if (!els.gallery) return;

    if (images.length === 0) {
        els.gallery.innerHTML = `<p class="col-span-full text-center py-4 text-slate-500">Vazio</p>`;
        return;
    }

    const emptyMsg = els.gallery.querySelector('p');
    if (emptyMsg) emptyMsg.remove();

    const gs = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    const slotMap = new Map();
    gs.forEach((id, idx) => { if (id) slotMap.set(id, idx + 1); });

    const hiddenIds = getHiddenImages();

    let displayImages = [];
    if (currentFilter === 'queue') {
        displayImages = images.filter(img => !slotMap.has(img.id) && !hiddenIds.includes(img.id));
    } else if (currentFilter === 'wall') {
        displayImages = images.filter(img => slotMap.has(img.id));
    } else if (currentFilter === 'removed') {
        displayImages = images.filter(img => hiddenIds.includes(img.id));
    }

    const activeIds = new Set();

    displayImages.forEach(img => {
        activeIds.add(img.id);

        let card = document.getElementById(`card-${img.id}`);
        const isOnWall = slotMap.has(img.id);
        const isHidden = hiddenIds.includes(img.id);
        const slotNum = slotMap.get(img.id);

        if (!card) {
            card = document.createElement('div');
            card.id = `card-${img.id}`;
            card.className = "aspect-square bg-slate-800 rounded-lg relative overflow-hidden group border-2 transition-all duration-300";

            card.innerHTML = `
                <img src="${img.url}" class="w-full h-full object-cover">
                <div class="absolute top-0 left-0 bg-black/60 text-white text-[10px] font-bold px-1 rounded-br ${slotNum ? '' : 'hidden'} slot-badge">
                    #${slotNum || ''}
                </div>
                <div class="absolute inset-0 bg-black/80 hidden group-hover:flex flex-col items-center justify-center gap-2 transition-all backdrop-blur-sm z-10">
                    <button class="act-btn bg-white text-black text-[10px] px-2 py-1 rounded font-bold uppercase"></button>
                </div>
            `;

            const btn = card.querySelector('.act-btn');
            btn.onclick = () => handleCardAction(img.id, isOnWall, isHidden);

            els.gallery.appendChild(card);
        }

        const badge = card.querySelector('.slot-badge');
        const btn = card.querySelector('.act-btn');

        let borderColor = 'border-slate-700';
        let opacityClass = '';

        if (isOnWall) {
            borderColor = 'border-green-500';
        } else if (isHidden) {
            borderColor = 'border-red-900';
            opacityClass = 'opacity-50';
        }

        card.className = `aspect-square bg-slate-800 rounded-lg relative overflow-hidden group border-2 transition-all duration-300 ${borderColor} ${opacityClass}`;

        if (isOnWall) {
            badge.textContent = `#${slotNum}`;
            badge.classList.remove('hidden');
            btn.textContent = 'Remover';
            btn.className = 'act-btn bg-red-600 text-white text-[10px] px-2 py-1 rounded';
        } else if (isHidden) {
            badge.classList.add('hidden');
            btn.textContent = 'Restaurar';
            btn.className = 'act-btn bg-slate-500 text-white text-[10px] px-2 py-1 rounded';
        } else {
            badge.classList.add('hidden');
            btn.textContent = 'Bloquear';
            btn.className = 'act-btn bg-red-900 text-white text-[10px] px-2 py-1 rounded';
        }

        btn.onclick = () => handleCardAction(img.id, isOnWall, isHidden);
    });

    Array.from(els.gallery.children).forEach(child => {
        if (child.id && child.id.startsWith('card-')) {
            const id = child.id.replace('card-', '');
            if (!activeIds.has(id)) {
                child.remove();
            }
        }
    });
}

function handleCardAction(id, onWall, hidden) {
    if (onWall || !hidden) {
        addHiddenImage(id);
    } else {
        let h = getHiddenImages().filter(x => x !== id);
        localStorage.setItem(HIDDEN_IMAGES_KEY, JSON.stringify(h));
        syncChannel.postMessage({ type: 'HIDDEN_UPDATE' });
    }
    fetchGallery();
}

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
    initAccordions();
    initStatusMonitor();
    checkServerHealth();
    setInterval(checkServerHealth, 10000);
    initAdminBroadcastHandlers();

    updateUI();
    setupListeners();
    initAdminSearch();
    setInterval(fetchGallery, 1000);
    fetchGallery();
}

bootAdmin();

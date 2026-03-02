import './style.css';
import {
    CONFIG_KEY,
    GRID_STATE_KEY,
    API_BASE_URL,
    API_ORIGIN,
    loadConfig,
    saveConfig,
    syncChannel,
    getHiddenImages,
    scheduleStateSync,
    restoreStateFromServer
} from './shared.js';

// --- ESTADO GLOBAL ---
let config = loadConfig();
let globalBackendImages = [];
let lastHeroTime = Date.now();
let lastActivityTime = Date.now();
let queueTimeoutId = null;
let isUpdatingUI = false;

// Garante defaults para os filtros de background
config.bgBrightness = config.bgBrightness ?? 100;
config.bgContrast = config.bgContrast ?? 100;
config.bgSaturate = config.bgSaturate ?? 100;
config.bgBlur = config.bgBlur ?? 0;

// Defaults: animação de chegada (fly/outline)
config.entryFlyToSlot = config.entryFlyToSlot ?? false;
config.entryBorderWidth = config.entryBorderWidth ?? 2;
config.entryBorderOpacity = config.entryBorderOpacity ?? 18;
config.entryBorderRadius = config.entryBorderRadius ?? 14;

// Garante default e normalização da intensidade do overlay (0–100)
let ov = config.overlayStrength;
if (typeof ov !== 'number') ov = parseInt(ov || '100', 10);
if (Number.isNaN(ov)) ov = 100;
ov = Math.min(100, Math.max(0, ov));
config.overlayStrength = ov;

// --- ELEMENTOS UI ---
const getEls = () => ({
    autoCheck: document.getElementById('auto-grid'),
    photoW: document.getElementById('photo-width'),
    photoH: document.getElementById('photo-height'),
    gridCols: document.getElementById('grid-cols'),
    gridRows: document.getElementById('grid-rows'),
    gapIn: document.getElementById('grid-gap'),
    opacityIn: document.getElementById('image-opacity'),
    bgUrl: document.getElementById('background-url'),
    animType: document.getElementById('anim-type'),
    animDur: document.getElementById('anim-duration'),
    randCheck: document.getElementById('random-position'),
    persistCheck: document.getElementById('persist-state'),
    heroCheck: document.getElementById('hero-enabled'),
    idleCheck: document.getElementById('idle-enabled'),
    removalCheck: document.getElementById('removal-mode'),
    toggleBtn: document.getElementById('toggle-processing'),
    processInterval: document.getElementById('process-interval'),
    panel: document.getElementById('config-panel'),
    openBtn: document.getElementById('open-config'),
    closeBtn: document.getElementById('close-config'),
    closeX: document.getElementById('close-config-x'),
    manualDiv: document.getElementById('manual-settings'),
    autoDiv: document.getElementById('auto-settings'),
    statBackend: document.getElementById('total-backend-images'),
    statQueue: document.getElementById('queue-count'),
    statScreen: document.getElementById('total-on-screen'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    captureWallBtn: document.getElementById('capture-wall-btn'),
});

const socialWall = document.getElementById('social-wall');

// --- BACKOFF: em falhas consecutivas aumenta o intervalo (3s → 6s → 12s … máx 30s) ---
let pollFailures = 0;
const POLL_BASE_MS = 3000;
const POLL_MAX_MS = 30000;

// --- POLLING RESILIENTE (Recursivo + backoff em falhas) ---
const pollImages = async () => {
    try {
        const url = `${API_BASE_URL}?source=${config.sourceMode || 'local'}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const prevCount = globalBackendImages.length;
            globalBackendImages = data;
            pollFailures = 0;

            if (config.layoutMode === 'fit-all' && data.length !== prevCount) {
                applyLayoutAndEffects();
            }

            document.body.classList.remove('offline-mode');
            updateWaitingOverlay();
        }
    } catch (e) {
        pollFailures++;
        console.warn("Falha na conexão com backend. Tentando reconectar...");
        document.body.classList.add('offline-mode');
        updateWaitingOverlay();
    } finally {
        const delay = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(2, pollFailures));
        setTimeout(pollImages, delay);
    }
};

// --- OVERLAY "Aguardando fotos" (visível quando não há imagens no mural) ---
function updateWaitingOverlay() {
    const overlay = document.getElementById('waiting-overlay');
    if (!overlay) return;
    const slots = socialWall ? Array.from(socialWall.children) : [];
    const hasAnyImage = slots.some(slot => slot.querySelector('img'));
    const hasBackendImages = globalBackendImages.length > 0;
    const show = !hasAnyImage && !hasBackendImages;
    overlay.classList.toggle('hidden', !show);
    overlay.setAttribute('aria-hidden', String(!show));
}

// --- SSE: atualização imediata quando novas fotos chegam (Dropbox, câmera, upload) ---
try {
    const eventSource = new EventSource(`${API_ORIGIN}/events`);
    eventSource.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data?.event === 'images_updated') pollImages();
        } catch (_) { /* mensagens de log não são JSON com event */ }
    };
    eventSource.onerror = () => { /* reconexão automática pelo EventSource */ };
} catch (_) {
    console.warn('[Wall] SSE não disponível; usando apenas polling a cada 3s.');
}

// --- TELA CHEIA + WAKE LOCK (telão) ---
let wakeLockRef = null;
async function requestWakeLock() {
    try {
        if (navigator.wakeLock && !wakeLockRef) {
            wakeLockRef = await navigator.wakeLock.request('screen');
            wakeLockRef.addEventListener('release', () => { wakeLockRef = null; });
        }
    } catch (_) { /* Wake Lock não suportado ou já ativo */ }
}
function releaseWakeLock() {
    try {
        if (wakeLockRef) {
            wakeLockRef.release();
            wakeLockRef = null;
        }
    } catch (_) { }
}
function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
async function toggleFullscreen() {
    const el = document.getElementById('main-container') || document.documentElement;
    try {
        if (isFullscreen()) {
            document.exitFullscreen?.() || document.webkitExitFullscreen?.();
            releaseWakeLock();
        } else {
            (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())?.();
            await requestWakeLock();
        }
    } catch (e) {
        console.warn('[Wall] Fullscreen:', e.message);
    }
}
function updateFullscreenButtonLabel() {
    const btn = document.getElementById('fullscreen-btn');
    if (btn) btn.textContent = isFullscreen() ? '⛶ Sair da tela cheia' : '⛶ Tela cheia';
}

// --- FUNÇÃO DE EXPORTAÇÃO (SOUVENIR) ---
function triggerSouvenirExport(photoId, slotDiv, currentConfig, slotIndex) {
    if (!currentConfig.exportEnabled) return;

    const useBackground = currentConfig.exportWithBackground !== false;
    if (!useBackground || !currentConfig.backgroundUrl) {
        console.warn('[Exportador Wall] Exportando sem background (apenas foto).');
    }

    const cols = currentConfig.cols || 1;
    const rows = currentConfig.rows || 1;

    const row = Math.floor(slotIndex / cols);
    const col = slotIndex % cols;

    // 1. Normaliza Opacidade
    let opacity = currentConfig.opacity;
    if (typeof opacity === 'string') opacity = parseFloat(opacity);
    if (Number.isNaN(opacity) || opacity <= 0 || opacity > 1) opacity = 1;

    // 2. Calcula Coordenadas do Slot
    const slotRect = slotDiv.getBoundingClientRect();
    const slotCoords = {
        x: Math.round(slotRect.left),
        y: Math.round(slotRect.top),
        w: Math.round(slotRect.width),
        h: Math.round(slotRect.height)
    };

    const gridNumber = currentConfig.showGridNumber ? (slotIndex + 1) : null;

    console.log('[TRIGGER EXPORT] Enviando:', {
        photoId,
        slotIndex,
        gridNumber,
        slotCoords,
        opacity,
        overlayStrength: currentConfig.overlayStrength
    });

    // 3. Monta Payload
    const exportData = {
        photoId,
        backgroundUrl: useBackground ? currentConfig.backgroundUrl : null,
        tile: { row, col, cols, rows }, // Info da célula na matriz
        slotCoords,                     // Info de pixels na tela
        exportSize: {
            w: currentConfig.exportWidth || 1080,
            h: currentConfig.exportHeight || 1080
        },
        opacity, // <--- CRÍTICO: Envia a opacidade (ex: 0.4)
        gridNumber,
        bgFilters: {
            brightness: currentConfig.bgBrightness ?? 100,
            contrast: currentConfig.bgContrast ?? 100,
            saturate: currentConfig.bgSaturate ?? 100,
            blur: currentConfig.bgBlur ?? 0
        },
        overlayStrength: currentConfig.overlayStrength ?? 100 // Envia força do overlay
    };

    fetch(`${API_ORIGIN}/api/export-collage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData)
    })
        .then(res => {
            if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (data.url) {
                console.log(`[Exportador Wall] Sucesso! URL: ${data.url}`);
            } else {
                console.warn('[Exportador Wall] Resposta sem URL:', data);
            }
        })
        .catch(err => {
            console.error('[Exportador Wall] Erro ao chamar API:', err);
        });
}

// --- COMUNICAÇÃO (WS/BroadcastChannel) ---
if (syncChannel) {
    syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'CONFIG_UPDATE') {
            config = event.data.data;

            // normaliza overlayStrength
            let ov = config.overlayStrength;
            if (typeof ov !== 'number') ov = parseInt(ov || '100', 10);
            if (Number.isNaN(ov)) ov = 100;
            ov = Math.min(100, Math.max(0, ov));
            config.overlayStrength = ov;

            requestAnimationFrame(() => {
                applyLayoutAndEffects();
                updateLocalMenuUI();
            });
        }
        if (event.data && event.data.type === 'HIDDEN_UPDATE') {
            setTimeout(processQueueStep, 50);
        }
        if (event.data.type === 'CAPTURE_WALL') {
            captureFullWallSnapshot(true);
        }
        // Listener para testes visuais do Admin
        if (event.data.type === 'TEST_EFFECT') {
            handleTestEffectFromAdmin(event.data.data);
        }
    };
}

setInterval(() => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
        const diskConfig = JSON.parse(stored);
        if (JSON.stringify(diskConfig) !== JSON.stringify(config)) {
            config = diskConfig;

            let ov = config.overlayStrength;
            if (typeof ov !== 'number') ov = parseInt(ov || '100', 10);
            if (Number.isNaN(ov)) ov = 100;
            ov = Math.min(100, Math.max(0, ov));
            config.overlayStrength = ov;

            applyLayoutAndEffects();
            updateLocalMenuUI();
        }
    }
}, 1000);

const SLOT_SELECTOR = '.grid-cell, .slot, .tile, .photo-slot, [data-slot]';

function getAnySlotDivForTest() {
    // Tenta pegar o primeiro container de imagem disponível
    const el = document.querySelector('.image-container');
    return el || null;
}

function runBaseEntryAnim(el) {
    const type = (config.animType || 'pop');
    const dur = Math.max(80, Number(config.animDuration || 600));

    // Web Animations API (bem estável em Chrome)
    if (type === 'fade') {
        el.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: dur, easing: 'ease-out', fill: 'both' }
        );
        return dur;
    }

    if (type === 'slide-up') {
        el.animate(
            [{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'translateY(0px)', opacity: 1 }],
            { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
        );
        return dur;
    }

    if (type === 'rotate') {
        el.animate(
            [{ transform: 'scale(0.75) rotate(-6deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
            { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
        );
        return dur;
    }

    // default: pop
    el.animate(
        [{ transform: 'scale(0.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    return dur;
}

async function handleTestEffectFromAdmin(data) {
    const effect = data?.effect;
    const url = data?.url;
    if (!effect || !url) return;

    const slot = getAnySlotDivForTest();
    if (!slot) {
        console.warn('[Main] TEST_EFFECT: nenhum slot encontrado. O grid pode estar vazio.');
        return;
    }

    // cria um overlay dentro do slot (não destrói seu conteúdo real)
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.zIndex = '999999';
    wrap.style.pointerEvents = 'none';

    // garante que o slot aceita posicionamento absoluto do overlay
    const prevPos = slot.style.position;
    if (!prevPos || prevPos === 'static') slot.style.position = 'relative';

    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.style.opacity = '1';

    wrap.appendChild(img);
    slot.appendChild(wrap);

    try {
        if (effect === 'entry') {
            const ms = runBaseEntryAnim(img);
            // segura um pouquinho pra você ver e remove
            setTimeout(() => wrap.remove(), ms + 600);
            return;
        }

        // (opcional) se você também quiser suportar fly/hero depois:
        if (effect === 'fly' && typeof playEntryFlyToSlot === 'function') {
            // Reaproveita sua função existente:
            // Faz o ghost voar até o slot; depois remove overlay
            await playEntryFlyToSlot(url, slot);
            setTimeout(() => wrap.remove(), 300);
            return;
        }

        if (effect === 'hero') {
            // hero simples (zoom + glow) só pra teste rápido
            const dur = Math.max(200, Number(config.entryAnimSpeed || 500));
            const hold = Math.max(600, Number(config.entryDuration || 3000));

            img.animate(
                [{ transform: 'scale(1)', filter: 'none' }, { transform: `scale(${config.entryScale || 1.5})`, filter: 'drop-shadow(0 20px 60px rgba(0,0,0,.55))' }],
                { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
            );

            setTimeout(() => {
                img.animate(
                    [{ transform: `scale(${config.entryScale || 1.5})` }, { transform: 'scale(1)' }],
                    { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
                );
                setTimeout(() => wrap.remove(), dur + 80);
            }, hold);

            return;
        }

        // fallback
        setTimeout(() => wrap.remove(), 1200);
    } catch (e) {
        console.error('[Main] TEST_EFFECT error:', e);
        wrap.remove();
    }
}

// --- LAYOUT ---
function calculateGridDimensions() {
    // 🔒 Se o layout estiver travado, respeita sempre cols/rows atuais
    if (config.layoutLocked) {
        return {
            cols: config.cols || 4,
            rows: config.rows || 3
        };
    }

    const W = window.innerWidth;
    const H = window.innerHeight;

    if (config.layoutMode === 'target') {
        const target = Math.max(1, config.targetCount || 20);
        const screenRatio = W / H;
        let bestCols = Math.ceil(Math.sqrt(target * screenRatio));
        let bestRows = Math.ceil(target / bestCols);
        return { cols: bestCols, rows: bestRows };
    }

    if (config.layoutMode === 'fit-all') {
        const screenRatio = W / H;
        const hiddenImages = getHiddenImages();
        const available = globalBackendImages.filter(img => !hiddenImages.includes(img.id));
        let target = available.length;

        if (target <= 0) target = Math.max(1, config.targetCount || 20);

        let bestCols = Math.ceil(Math.sqrt(target * screenRatio));
        let bestRows = Math.ceil(target / bestCols);

        bestCols = Math.max(1, bestCols);
        bestRows = Math.max(1, bestRows);

        return { cols: bestCols, rows: bestRows };
    }

    if (config.layoutMode === 'auto-fit') {
        const pW = Math.max(50, config.photoWidth || 300);
        const pH = Math.max(50, config.photoHeight || 300);
        return {
            cols: Math.max(1, Math.floor(W / pW)),
            rows: Math.max(1, Math.floor(H / pH))
        };
    }

    return { cols: config.cols || 4, rows: config.rows || 3 };
}

function applyLayoutAndEffects() {
    if (!socialWall) return;
    applyBackground();

    const dims = calculateGridDimensions();

    if (dims.cols !== config.cols || dims.rows !== config.rows) {
        config.cols = dims.cols;
        config.rows = dims.rows;
        if (config.layoutMode !== 'manual') {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            scheduleStateSync();
        }
    }

    socialWall.style.display = 'grid';
    socialWall.style.width = '100vw';
    socialWall.style.height = '100vh';
    socialWall.style.boxSizing = 'border-box';
    socialWall.style.overflow = 'hidden';

    socialWall.style.gap = `${config.gap}px`;
    socialWall.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    socialWall.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;

    const totalSlots = config.cols * config.rows;

    while (socialWall.children.length > totalSlots) socialWall.removeChild(socialWall.lastChild);
    while (socialWall.children.length < totalSlots) {
        const d = document.createElement('div');
        d.className = 'image-container relative overflow-hidden w-full h-full flex items-center justify-center bg-gray-800/50';
        d.style.minWidth = '0';
        d.style.minHeight = '0';
        socialWall.appendChild(d);
    }

    // Atualiza opacidade das imagens já existentes
    document.querySelectorAll('.image-container img').forEach(img => img.style.opacity = config.opacity);

    // Atualiza o "patch" do background em todos os slots (efeito visual na tela)
    const slots = Array.from(socialWall.children);
    slots.forEach((div, i) => {
        const hasImage = !!div.querySelector('img');
        updateSlotBackgroundSlice(div, i, hasImage);
        updateSlotNumberOverlay(div, i, hasImage);
    });
    updateWaitingOverlay();

    if (config.processing) {
        if (!queueTimeoutId) loopQueue();
    } else {
        clearTimeout(queueTimeoutId);
        queueTimeoutId = null;
    }
}

// --- BACKGROUND + FILTROS (Visual na Tela) ---
function applyBackground() {
    const rootStyle = document.documentElement.style;

    if (config.backgroundUrl) {
        rootStyle.setProperty('--wall-bg-image', `url('${config.backgroundUrl}')`);
    } else {
        rootStyle.setProperty('--wall-bg-image', 'none');
    }

    const b = config.bgBrightness ?? 100;
    const c = config.bgContrast ?? 100;
    const s = config.bgSaturate ?? 100;
    const blur = config.bgBlur ?? 0;

    const filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) blur(${blur}px)`;
    rootStyle.setProperty('--wall-bg-filter', filter);

    document.body.style.backgroundColor = '#111827';
}

// --- MENU LATERAL (UI Local) ---
function setupLocalListeners() {
    const els = getEls();
    const toggleMenu = () => els.panel?.classList.toggle('open');
    if (els.openBtn) els.openBtn.addEventListener('click', toggleMenu);
    if (els.closeBtn) els.closeBtn.addEventListener('click', toggleMenu);
    if (els.closeX) els.closeX.addEventListener('click', toggleMenu);

    if (els.fullscreenBtn) els.fullscreenBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenButtonLabel);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtonLabel);

    if (els.captureWallBtn) {
        els.captureWallBtn.addEventListener('click', () => {
            captureFullWallSnapshot();
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'c' && e.target.tagName !== 'INPUT') toggleMenu();
    });

    const bind = (el, key, parser = v => v) => {
        if (!el) return;
        el.addEventListener('input', (e) => {
            if (isUpdatingUI) return;
            const val = parser(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
            config[key] = val;
            saveConfig(config);

            if (['cols', 'rows', 'autoGrid', 'photoWidth', 'photoHeight', 'gap'].includes(key)) {
                applyLayoutAndEffects();
            }
            if (key === 'opacity') {
                document.querySelectorAll('img').forEach(i => i.style.opacity = val);
            }
            if (key === 'processInterval') {
                const span = document.getElementById('process-interval-val');
                if (span) span.textContent = (val / 1000) + 's';
            }
        });
    };

    bind(els.autoCheck, 'autoGrid');
    bind(els.photoW, 'photoWidth', parseInt);
    bind(els.photoH, 'photoHeight', parseInt);
    bind(els.gridCols, 'cols', parseInt);
    bind(els.gridRows, 'rows', parseInt);
    bind(els.gapIn, 'gap', parseInt);
    bind(els.opacityIn, 'opacity', v => parseFloat(v) / 100);
    bind(els.animType, 'animType');
    bind(els.animDur, 'animDuration', parseInt);
    bind(els.randCheck, 'randomPosition');
    bind(els.persistCheck, 'persistGrid');
    bind(els.heroCheck, 'heroEnabled');
    bind(els.idleCheck, 'idleEnabled');
    bind(els.removalCheck, 'removalMode');
    bind(els.processInterval, 'processInterval', v => parseFloat(v) * 1000);

    if (els.toggleBtn) {
        els.toggleBtn.addEventListener('click', () => {
            config.processing = !config.processing;
            saveConfig(config);
            updateLocalMenuUI();
            if (config.processing) loopQueue();
        });
    }

    if (socialWall) {
        socialWall.addEventListener('click', (e) => {
            if (!config.removalMode) return;
            const container = e.target.closest('.image-container');
            if (!container) return;
            const idx = Array.from(socialWall.children).indexOf(container);
            let gs = loadGridState();
            gs[idx] = null;
            saveGridState(gs);
            renderCurrentState(gs, new Map(globalBackendImages.map(i => [i.id, i])));
        });
    }
}

function updateLocalMenuUI() {
    isUpdatingUI = true;
    const els = getEls();
    if (els.gridCols) els.gridCols.value = config.cols;
    if (els.gridRows) els.gridRows.value = config.rows;
    if (els.autoCheck) els.autoCheck.checked = config.autoGrid;
    if (els.photoW) els.photoW.value = config.photoWidth;
    if (els.photoH) els.photoH.value = config.photoHeight;
    if (els.gapIn) els.gapIn.value = config.gap;
    if (els.opacityIn) els.opacityIn.value = (config.opacity || 1) * 100;

    if (els.toggleBtn) {
        const icon = document.getElementById('toggle-icon');
        const text = document.getElementById('toggle-text');
        if (config.processing) {
            if (icon) icon.textContent = '⏸️';
            if (text) text.textContent = 'Pausar';
            els.toggleBtn.className = 'w-full p-3 bg-red-600 hover:bg-red-700 rounded-lg font-bold transition mb-4 flex items-center justify-center gap-2';
        } else {
            if (icon) icon.textContent = '▶️';
            if (text) text.textContent = 'Começar';
            els.toggleBtn.className = 'w-full p-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition mb-4 flex items-center justify-center gap-2';
        }
    }
    isUpdatingUI = false;
}

// --- ESTADO DO GRID ---
function loadGridState() {
    if (!config.persistGrid) return [];
    try {
        return JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}
function saveGridState(state) {
    if (config.persistGrid) {
        localStorage.setItem(GRID_STATE_KEY, JSON.stringify(state));
        scheduleStateSync();
    }
}

async function captureFullWallSnapshot(shouldNotifyChannel = false) {
    try {
        console.log("Solicitando snapshot ao servidor...");
        // Chama a nova rota do servidor
        const res = await fetch(`${API_ORIGIN}/api/generate-wall-snapshot`, {
            method: 'POST'
        });

        if (!res.ok) throw new Error('Erro no servidor');

        const data = await res.json();
        console.log('Snapshot gerado:', data.url);

        if (shouldNotifyChannel && syncChannel) {
            syncChannel.postMessage({
                type: 'CAPTURE_WALL_DONE',
                data: { url: data.url }
            });
        }
    } catch (e) {
        console.error('Erro:', e);
        if (shouldNotifyChannel && syncChannel) {
            syncChannel.postMessage({ type: 'CAPTURE_WALL_ERROR', data: { message: e.message } });
        }
    }
}

// --- AUXILIARES DE RENDERIZAÇÃO ---
function updateSlotNumberOverlay(div, slotIndex, hasImage) {
    const existing = div.querySelector('.grid-slot-number');

    if (!hasImage || !config.showGridNumber) {
        if (existing) existing.remove();
        return;
    }

    const gridNumber = slotIndex + 1;
    const label = existing || document.createElement('div');

    label.className =
        'grid-slot-number absolute top-1 left-1 text-white text-[11px] font-semibold ' +
        'drop-shadow-md pointer-events-none select-none';

    label.textContent = `#${gridNumber}`;

    if (!existing) {
        div.appendChild(label);
    }
}

function updateSlotBackgroundSlice(div, slotIndex, hasImage) {
    const cols = config.cols || 1;
    const rows = config.rows || 1;

    const col = cols > 0 ? (slotIndex % cols) : 0;
    const row = cols > 0 ? Math.floor(slotIndex / cols) : 0;

    const size = `${cols * 100}% ${rows * 100}%`;

    let posX = '50%';
    let posY = '50%';

    if (cols > 1) posX = `${(col / (cols - 1)) * 100}%`;
    if (rows > 1) posY = `${(row / (rows - 1)) * 100}%`;

    div.style.setProperty('--slot-bg-size', size);
    div.style.setProperty('--slot-bg-pos', `${posX} ${posY}`);

    // Calcula opacidade do overlay (0 a 1)
    let strength = config.overlayStrength;
    if (typeof strength === 'string') strength = parseInt(strength || '100', 10);
    if (Number.isNaN(strength)) strength = 100;
    strength = Math.min(100, Math.max(0, strength));

    // Se tem imagem, aplica overlay. Se não, transparente.
    const finalAlpha = hasImage ? (strength / 100) : 0;
    div.style.setProperty('--slot-overlay-opacity', String(finalAlpha));
}

function renderCurrentState(gridState, imageMap) {
    const slots = Array.from(socialWall.children);

    slots.forEach((div, i) => {
        const idInSlot = gridState[i] || null;
        const currentId = div.getAttribute('data-id') || null;

        // Slot vazio
        if (!idInSlot) {
            if (currentId) {
                div.innerHTML = '';
                div.setAttribute('data-id', '');
                updateSlotNumberOverlay(div, i, false);
                updateSlotBackgroundSlice(div, i, false);
            }
            return;
        }

        // Se imagem não mudou, ignora
        if (idInSlot === currentId) return;

        const data = imageMap.get(idInSlot);
        if (!data) return;

        const img = new Image();

        // 1. Permissão de CORS
        img.crossOrigin = "anonymous";

        img.className = 'w-full h-full object-cover block shadow-lg opacity-0 transition-opacity duration-500';

        img.onload = () => {
            div.innerHTML = '';
            div.setAttribute('data-id', idInSlot);
            div.appendChild(img);

            updateSlotNumberOverlay(div, i, true);
            updateSlotBackgroundSlice(div, i, true);

            requestAnimationFrame(() => {
                const useFly = !!config.entryFlyToSlot;

                if (!useFly) {
                    img.style.opacity = config.opacity;
                } else {
                    img.style.opacity = '0';
                }

                img.style.transform = 'scale(1) translateY(0) rotate(0)';

                if (useFly) {
                    playEntryFlyToSlot(data.url, div).then(() => {
                        img.style.opacity = config.opacity;
                        applyEntryHighlight(div);
                    });
                } else {
                    applyEntryHighlight(div);
                }

                setTimeout(() => {
                    triggerSouvenirExport(idInSlot, div, config, i);
                }, 100);
            });
        };

        img.onerror = () => {
            console.warn(`[Main] Falha ao carregar imagem: ${data.url}`);
        };

        // 2. Cache Buster: Adiciona ?t=tempo para forçar o navegador a pedir a imagem com permissão nova
        // Se a URL já tiver query string, usa &, senão usa ?
        const sep = data.url.includes('?') ? '&' : '?';
        img.src = `${data.url}${sep}t=${Date.now()}`;
    });
    updateWaitingOverlay();
}
function applyEntryHighlight(div) {
    if (!div || !config.entryAnimation) return;

    const scale = config.entryScale || 1.5;
    const speed = config.entryAnimSpeed || 500; // ms
    const duration = config.entryDuration || 3000; // ms

    const bw = Number(config.entryBorderWidth ?? 0);
    const bo = Number(config.entryBorderOpacity ?? 0) / 100;
    const br = Number(config.entryBorderRadius ?? 0);

    div.style.setProperty('--hero-scale', scale);
    div.style.setProperty('--hero-transition', `${speed}ms`);
    div.classList.add('hero-active');

    if (bw > 0 && bo > 0) {
        div.style.outline = `${bw}px solid rgba(255,255,255,${bo})`;
        const off = -Math.min(4, Math.max(1, Math.round(bw / 2)));
        div.style.outlineOffset = `${off}px`;
    } else {
        div.style.outline = '';
        div.style.outlineOffset = '';
    }

    if (br > 0) div.style.borderRadius = `${br}px`;

    setTimeout(() => {
        div.classList.remove('hero-active');
        div.style.outline = '';
        div.style.outlineOffset = '';
        div.style.borderRadius = '';

        setTimeout(() => {
            div.style.removeProperty('--hero-scale');
            div.style.removeProperty('--hero-transition');
        }, speed + 100);
    }, duration);
}

function playEntryFlyToSlot(url, targetDiv) {
    return new Promise((resolve) => {
        if (!targetDiv) return resolve();

        // 1. Calcula posições de destino (Slot) e centro da tela
        const rect = targetDiv.getBoundingClientRect();
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const tx = rect.left + rect.width / 2;
        const ty = rect.top + rect.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;

        // 2. Cria o elemento "fantasma" (Ghost)
        const ghost = document.createElement('img');
        ghost.src = url;
        ghost.className = 'entry-fly-ghost';
        ghost.style.position = 'fixed';
        ghost.style.left = '50%';
        ghost.style.top = '50%';
        // Tamanho base igual ao do slot final
        ghost.style.width = `${Math.max(1, rect.width)}px`;
        ghost.style.height = `${Math.max(1, rect.height)}px`;
        ghost.style.objectFit = 'cover';
        ghost.style.transformOrigin = 'center center';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '999999';

        // --- ESTADO INICIAL (Melhoria aqui) ---
        // Começa invisível (opacity 0) e pequena (scale 0.5)
        ghost.style.opacity = '0';
        ghost.style.transform = `translate(-50%, -50%) scale(0.5)`;

        // Aplica bordas configuradas no Admin
        const bw = Number(config.entryBorderWidth ?? 2);
        const bo = Number(config.entryBorderOpacity ?? 18) / 100;
        const br = Number(config.entryBorderRadius ?? 14);
        if (bw > 0 && bo > 0) ghost.style.border = `${bw}px solid rgba(255,255,255,${bo})`;
        if (br > 0) ghost.style.borderRadius = `${br}px`;
        ghost.style.boxShadow = '0 20px 70px rgba(0,0,0,0.55)';

        document.body.appendChild(ghost);

        // Configurações de tempo
        const speed = config.entryAnimSpeed || 500;
        // Calcula quanto tempo ficar parada no centro (25% do tempo total ou min 350ms)
        const hold = Math.min(1200, Math.max(350, Math.round((config.entryDuration || 3000) * 0.25)));
        // Tamanho máximo no centro
        const centerScale = Math.min(8, Math.max(1, Number(config.entryFlyCenterScale ?? 1.8)));

        // 3. SEQUÊNCIA DE ANIMAÇÃO
        requestAnimationFrame(() => {
            // ETAPA A: "Pop-in" (Aparece crescendo e quicando)
            // cubic-bezier(0.34, 1.56, 0.64, 1) cria o efeito elástico
            ghost.style.transition = `transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 400ms ease-out`;

            ghost.style.opacity = '1';
            ghost.style.transform = `translate(-50%, -50%) scale(${centerScale})`;

            setTimeout(() => {
                ghost.style.transition = `transform ${speed}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${speed}ms ease-in`;
                ghost.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1)`;

                setTimeout(() => {
                    ghost.style.opacity = '0';
                    setTimeout(() => {
                        ghost.remove();
                        resolve();
                    }, 200);
                }, speed);

            }, 600 + hold);
        });
    });
}

// --- FILA (UMA POR VEZ) ---
function processQueueStep() {
    if (globalBackendImages.length === 0) return;

    const dims = calculateGridDimensions();
    const totalSlots = dims.cols * dims.rows;
    let gridState = loadGridState();

    if (gridState.length !== totalSlots) {
        const newState = new Array(totalSlots).fill(null);
        for (let i = 0; i < Math.min(gridState.length, totalSlots); i++) newState[i] = gridState[i];
        gridState = newState;
    }

    const map = new Map();
    globalBackendImages.forEach(img => map.set(img.id, img));
    const availableIds = new Set(globalBackendImages.map(img => img.id));
    const hiddenImages = getHiddenImages();

    let hasChanges = false;

    // Limpa slots inválidos
    gridState = gridState.map(id => {
        if (id && (!availableIds.has(id) || hiddenImages.includes(id))) {
            hasChanges = true;
            return null;
        }
        return id;
    });

    const usedIds = new Set(gridState.filter(id => id !== null));

    // Candidatos (mais antigos primeiro, se sua lógica for FIFO)
    const candidates = globalBackendImages
        .filter(img => !usedIds.has(img.id) && !hiddenImages.includes(img.id))
        .sort((a, b) => a.timestamp - b.timestamp);

    let emptyIndices = [];
    gridState.forEach((val, i) => { if (val === null) emptyIndices.push(i); });

    if (emptyIndices.length > 0 && candidates.length > 0) {
        let targetIdx = emptyIndices[0];

        if (config.randomPosition) {
            const rnd = Math.floor(Math.random() * emptyIndices.length);
            targetIdx = emptyIndices[rnd];
        }

        const img = candidates[0];
        gridState[targetIdx] = img.id;

        hasChanges = true;
        lastActivityTime = Date.now();
        console.log(`📸 Exibindo foto: ${img.id}`);
    }

    if (hasChanges) saveGridState(gridState);
    renderCurrentState(gridState, map);

    const els = getEls();
    if (els.statBackend) {
        els.statBackend.textContent = globalBackendImages.length;
        els.statScreen.textContent = gridState.filter(id => id).length;
        els.statQueue.textContent = candidates.length;
    }
}

// --- LOOP CONTROLADO ---
function loopQueue() {
    if (!config.processing) return;

    processQueueStep();

    if (queueTimeoutId) clearTimeout(queueTimeoutId);

    const delay = Math.max(500, config.processInterval);

    queueTimeoutId = setTimeout(loopQueue, delay);
}

async function init() {
    await restoreStateFromServer();
    config = loadConfig();

    config.bgBrightness = config.bgBrightness ?? 100;
    config.bgContrast = config.bgContrast ?? 100;
    config.bgSaturate = config.bgSaturate ?? 100;
    config.bgBlur = config.bgBlur ?? 0;

    let ov = config.overlayStrength;
    if (typeof ov !== 'number') ov = parseInt(ov || '100', 10);
    if (Number.isNaN(ov)) ov = 100;
    ov = Math.min(100, Math.max(0, ov));
    config.overlayStrength = ov;

    applyLayoutAndEffects();
    setupLocalListeners();
    updateLocalMenuUI();

    // Inicia polling resiliente
    pollImages();

    loopQueue();

    setInterval(() => {
        if (!config.processing) return;
        if (config.heroEnabled && (Date.now() - lastHeroTime > config.heroInterval * 1000)) {
            const slots = Array.from(socialWall.children).filter(d => d.querySelector('img'));
            if (slots.length) {
                const slot = slots[Math.floor(Math.random() * slots.length)];
                slot.classList.add('hero-active');
                setTimeout(() => slot.classList.remove('hero-active'), 5000);
            }
            lastHeroTime = Date.now();
        }
    }, 1000);

    window.addEventListener('resize', () => { applyLayoutAndEffects(); });

    // Modo telão: ?tela=1 abre em tela cheia e ativa Wake Lock
    const params = new URLSearchParams(window.location.search);
    if (params.get('tela') === '1') {
        setTimeout(() => {
            if (!isFullscreen()) toggleFullscreen();
        }, 500);
    }
}
document.addEventListener('DOMContentLoaded', init);
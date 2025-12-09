import './style.css';
import {
    CONFIG_KEY,
    GRID_STATE_KEY,
    API_BASE_URL,
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
});

const socialWall = document.getElementById('social-wall');

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
    // O Wall usa a viewport como referência, mas para garantir precisão, podemos enviar
    // as dimensões relativas se o servidor precisar calcular proporção.
    // Aqui enviamos coordenadas absolutas da tela.

    // IMPORTANTE: Se o container do Wall não for 100vw/100vh, isso precisaria de ajuste.
    // Assumimos tela cheia.
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

    fetch('http://localhost:3000/api/export-collage', {
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
        if (msg.type === 'CAPTURE_WALL') {
            captureFullWallSnapshot(true);
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
    if (!socialWall) {
        console.error('[Wall Snapshot] socialWall não encontrado.');
        if (shouldNotifyChannel && syncChannel) {
            try {
                syncChannel.postMessage({
                    type: 'CAPTURE_WALL_ERROR',
                    data: { message: 'socialWall não encontrado' }
                });
            } catch { }
        }
        return;
    }

    if (typeof window.html2canvas !== 'function') {
        console.error('[Wall Snapshot] html2canvas não carregado.');
        if (shouldNotifyChannel && syncChannel) {
            try {
                syncChannel.postMessage({
                    type: 'CAPTURE_WALL_ERROR',
                    data: { message: 'html2canvas não carregado' }
                });
            } catch { }
        }
        return;
    }

    // Verifica preenchimento (opcionalmente exige full)
    const totalSlots = (config.cols || 1) * (config.rows || 1);
    let gridState = loadGridState();
    if (!Array.isArray(gridState)) gridState = [];
    const filled = gridState.filter(id => id).length;

    console.log(`[Wall Snapshot] Slots preenchidos: ${filled}/${totalSlots}`);

    try {
        const canvas = await window.html2canvas(socialWall, {
            useCORS: true,
            backgroundColor: null,
            scale: 1
        });

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error('Falha ao gerar blob do mural.'));
            }, 'image/png', 1.0);
        });

        const formData = new FormData();
        const filename = `wall-${Date.now()}.png`;
        formData.append('file', blob, filename);
        formData.append('eventName', config.eventName || '');
        formData.append('exportBaseFolder', config.exportBaseFolder || '');

        const res = await fetch('http://localhost:3000/api/upload-wall-snapshot', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }

        const data = await res.json();
        console.log('[Wall Snapshot] Salvo em:', data.url);

        if (shouldNotifyChannel && syncChannel) {
            try {
                syncChannel.postMessage({
                    type: 'CAPTURE_WALL_DONE',
                    data: { url: data.url }
                });
            } catch { }
        }
    } catch (e) {
        console.error('[Wall Snapshot] Erro ao capturar mural:', e);
        if (shouldNotifyChannel && syncChannel) {
            try {
                syncChannel.postMessage({
                    type: 'CAPTURE_WALL_ERROR',
                    data: { message: e.message || 'Erro desconhecido' }
                });
            } catch { }
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

// --- RENDER CURRENT STATE ---


function renderCurrentState(gridState, imageMap) {
    const slots = Array.from(socialWall.children);

    slots.forEach((div, i) => {
        const idInSlot = gridState[i] || null;
        const currentId = div.getAttribute('data-id') || null;

        // Slot vazio ou sem mudança: lógica padrão
        if (!idInSlot) { /* ... */ return; }
        if (idInSlot === currentId) { /* ... */ return; }

        // Nova imagem nesse slot
        div.innerHTML = '';
        div.setAttribute('data-id', idInSlot);

        const data = imageMap.get(idInSlot);
        if (!data) { /* ... */ return; }

        const img = document.createElement('img');
        img.src = data.url;
        img.className = 'w-full h-full object-cover block shadow-lg';
        img.style.opacity = '0';
        // Transição suave para a opacidade
        img.style.transition = `opacity ${config.animDuration}ms ease-out`;

        let transform = 'scale(0.95)';
        if (config.animType === 'pop') transform = 'scale(0.5)';
        else if (config.animType === 'slide-up') transform = 'translateY(50px)';
        else if (config.animType === 'rotate') transform = 'rotate(-10deg)';
        img.style.transform = transform;

        div.appendChild(img);
        updateSlotNumberOverlay(div, i, true);
        updateSlotBackgroundSlice(div, i, true);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                img.style.opacity = config.opacity;
                img.style.transform = 'scale(1) translateY(0) rotate(0)';

                // 🟢 LÓGICA ATUALIZADA DA ANIMAÇÃO DE CHEGADA 🟢
                if (config.entryAnimation) {
                    // 1. Define as variáveis CSS dinamicamente para este slot
                    const scale = config.entryScale || 1.5;
                    const speed = config.entryAnimSpeed || 500; // ms
                    const duration = config.entryDuration || 3000; // ms

                    div.style.setProperty('--hero-scale', scale);
                    div.style.setProperty('--hero-transition', `${speed}ms`);

                    // 2. Adiciona a classe
                    div.classList.add('hero-active');

                    // 3. Remove após o tempo configurado
                    setTimeout(() => {
                        div.classList.remove('hero-active');

                        // Limpeza opcional das variáveis após animação
                        setTimeout(() => {
                            div.style.removeProperty('--hero-scale');
                            div.style.removeProperty('--hero-transition');
                        }, speed + 100); // espera a transição de saída terminar

                    }, duration);
                }
                // 🟢 FIM NOVA LÓGICA 🟢

                // dispara export...
                const slotDiv = slots[i];
                setTimeout(() => {
                    triggerSouvenirExport(idInSlot, slotDiv, config, i);
                }, 100);
            });
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

    const poll = async () => {
        try {
            const url = `${API_BASE_URL}?source=${config.sourceMode || 'local'}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                const prevCount = globalBackendImages.length;
                globalBackendImages = data;

                if (config.layoutMode === 'fit-all' && data.length !== prevCount) {
                    applyLayoutAndEffects();
                }
            }
        } catch (e) { }
    };
    await poll();
    setInterval(poll, 3000);

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
}
document.addEventListener('DOMContentLoaded', init);
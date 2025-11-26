import './style.css';
import { CONFIG_KEY, GRID_STATE_KEY, API_BASE_URL, loadConfig, saveConfig, syncChannel, getHiddenImages } from './shared.js';

// --- ESTADO GLOBAL ---
let config = loadConfig();
let globalBackendImages = [];
let lastHeroTime = Date.now();
let lastActivityTime = Date.now();
let queueTimeoutId = null; 
let isUpdatingUI = false;

// --- ELEMENTOS UI ---
const getEls = () => ({
    // Inputs do Menu Lateral
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
    processInterval: document.getElementById('process-interval'), // O Slider de Tempo
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

// --- COMUNICAÇÃO ---
if (syncChannel) {
    syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'CONFIG_UPDATE') {
            config = event.data.data;
            requestAnimationFrame(() => {
                applyLayoutAndEffects();
                updateLocalMenuUI();
            });
        }
        if (event.data && event.data.type === 'HIDDEN_UPDATE') {
            // Força um passo imediato se algo for escondido/restaurado
            setTimeout(processQueueStep, 50); 
        }
    };
}

setInterval(() => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
        const diskConfig = JSON.parse(stored);
        if (JSON.stringify(diskConfig) !== JSON.stringify(config)) {
            config = diskConfig;
            applyLayoutAndEffects();
            updateLocalMenuUI();
        }
    }
}, 1000);

// --- LAYOUT ---
function calculateGridDimensions() {
    const W = window.innerWidth;
    const H = window.innerHeight;

    if (config.layoutMode === 'target') {
        const target = Math.max(1, config.targetCount || 20);
        const screenRatio = W / H;
        let bestCols = Math.ceil(Math.sqrt(target * screenRatio));
        let bestRows = Math.ceil(target / bestCols);
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
        d.style.minWidth = '0'; d.style.minHeight = '0';
        socialWall.appendChild(d);
    }

    document.querySelectorAll('.image-container img').forEach(img => img.style.opacity = config.opacity);

    if (config.processing) {
        if (!queueTimeoutId) loopQueue();
    } else {
        clearTimeout(queueTimeoutId);
        queueTimeoutId = null;
    }
}

function applyBackground() {
    if (config.backgroundUrl) {
        document.body.style.backgroundImage = `url('${config.backgroundUrl}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    } else {
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = '#111827'; 
    }
}

// --- MENU LATERAL ---
function setupLocalListeners() {
    const els = getEls();
    const toggleMenu = () => els.panel?.classList.toggle('open');
    if (els.openBtn) els.openBtn.addEventListener('click', toggleMenu);
    if (els.closeBtn) els.closeBtn.addEventListener('click', toggleMenu);
    if (els.closeX) els.closeX.addEventListener('click', toggleMenu);
    window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'c' && e.target.tagName !== 'INPUT') toggleMenu(); });

    const bind = (el, key, parser = v => v) => {
        if (!el) return;
        el.addEventListener('input', (e) => {
            if (isUpdatingUI) return;
            const val = parser(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
            config[key] = val;
            saveConfig(config);
            if (['cols', 'rows', 'autoGrid', 'photoWidth', 'photoHeight', 'gap'].includes(key)) applyLayoutAndEffects();
            if (key === 'opacity') document.querySelectorAll('img').forEach(i => i.style.opacity = val);
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
            if (icon) icon.textContent = "⏸️"; if (text) text.textContent = "Pausar";
            els.toggleBtn.className = "w-full p-3 bg-red-600 hover:bg-red-700 rounded-lg font-bold transition mb-4 flex items-center justify-center gap-2";
        } else {
            if (icon) icon.textContent = "▶️"; if (text) text.textContent = "Começar";
            els.toggleBtn.className = "w-full p-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition mb-4 flex items-center justify-center gap-2";
        }
    }
    isUpdatingUI = false;
}

// --- RENDER ---
function loadGridState() {
    if (!config.persistGrid) return [];
    try { return JSON.parse(localStorage.getItem(GRID_STATE_KEY) || '[]'); } catch (e) { return []; }
}
function saveGridState(state) {
    if (config.persistGrid) localStorage.setItem(GRID_STATE_KEY, JSON.stringify(state));
}

function renderCurrentState(gridState, imageMap) {
    const slots = Array.from(socialWall.children);
    slots.forEach((div, i) => {
        const idInSlot = gridState[i];
        const currentId = div.getAttribute('data-id');
        if (idInSlot === currentId && idInSlot) {
            const img = div.querySelector('img');
            if (img) img.style.opacity = config.opacity;
            return; 
        }
        div.innerHTML = ''; div.setAttribute('data-id', idInSlot || '');
        if (idInSlot) {
            const data = imageMap.get(idInSlot);
            if (data) {
                const img = document.createElement('img');
                img.src = data.url;
                img.className = 'w-full h-full object-cover block shadow-lg';
                img.style.opacity = '0';
                img.style.transition = `all ${config.animDuration}ms ease-out`;
                let transform = 'scale(0.95)';
                if (config.animType === 'pop') transform = 'scale(0.5)';
                if (config.animType === 'slide-up') transform = 'translateY(50px)';
                if (config.animType === 'rotate') transform = 'rotate(-10deg)';
                img.style.transform = transform;
                div.appendChild(img);
                requestAnimationFrame(() => { requestAnimationFrame(() => { img.style.opacity = config.opacity; img.style.transform = 'scale(1) translateY(0) rotate(0)'; }); });
            }
        }
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

    // Limpa slots com imagens que não existem mais OU que agora estão escondidas
    gridState = gridState.map(id => {
        if (id && (!availableIds.has(id) || hiddenImages.includes(id))) {
            hasChanges = true;
            return null;
        }
        return id;
    });

    const usedIds = new Set(gridState.filter(id => id !== null));

    // Candidatos EXCLUINDO imagens já usadas e as escondidas
    const candidates = globalBackendImages
        .filter(img => !usedIds.has(img.id) && !hiddenImages.includes(img.id))
        .sort((a, b) => b.timestamp - a.timestamp); // mantém sua lógica original (mais novas primeiro)

    let emptyIndices = [];
    gridState.forEach((val, i) => { if (val === null) emptyIndices.push(i); });

    // Só coloca UMA imagem por tick
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

    // Menu Stats
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

    // Processa UMA imagem
    processQueueStep();

    // Limpa timeout anterior
    if (queueTimeoutId) clearTimeout(queueTimeoutId);

    // Define o próximo tick EXATAMENTE com o valor do slider
    const delay = Math.max(500, config.processInterval);

    queueTimeoutId = setTimeout(loopQueue, delay);
}

async function init() {
    applyLayoutAndEffects();
    setupLocalListeners();
    updateLocalMenuUI();

    const poll = async () => {
        try {
            const url = `${API_BASE_URL}?source=${config.sourceMode || 'local'}`;
            const res = await fetch(url); if (res.ok) globalBackendImages = await res.json();
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

    window.addEventListener('resize', () => { updateGridLayout(); });
}
document.addEventListener('DOMContentLoaded', init);

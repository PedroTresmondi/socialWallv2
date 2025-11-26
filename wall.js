import './style.css';
import { CONFIG_KEY, GRID_STATE_KEY, API_BASE_URL, loadConfig, saveConfig, syncChannel, getHiddenImages } from './shared.js';

let config = loadConfig();
let globalBackendImages = [];
let lastHeroTime = Date.now();
let lastActivityTime = Date.now();
let queueTimeoutId = null; 

// --- COMUNICAÇÃO ---
if (syncChannel) {
    syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'CONFIG_UPDATE') {
            config = event.data.data;
            requestAnimationFrame(() => applyLayoutAndEffects());
        }
        // Removemos a chamada forçada aqui para respeitar o timer
    };
}

setInterval(() => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
        const diskConfig = JSON.parse(stored);
        // Verifica mudanças visuais
        if (JSON.stringify(diskConfig) !== JSON.stringify(config)) {
            config = diskConfig;
            applyLayoutAndEffects();
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
    const socialWall = document.getElementById('social-wall');
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

    // Reinicia o loop apenas se não estiver rodando
    if (config.processing && !queueTimeoutId) {
        loopQueue();
    } else if (!config.processing) {
        clearTimeout(queueTimeoutId);
        queueTimeoutId = null;
    }
}

function applyBackground() {
    // Remove background do body para usar camada separada
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = '#111827';

    let bgLayer = document.getElementById('wall-background-layer');
    if (!bgLayer) {
        bgLayer = document.createElement('div');
        bgLayer.id = 'wall-background-layer';
        bgLayer.style.position = 'fixed';
        bgLayer.style.top = '0';
        bgLayer.style.left = '0';
        bgLayer.style.width = '100%';
        bgLayer.style.height = '100%';
        bgLayer.style.zIndex = '-1'; // Atrás de tudo
        bgLayer.style.pointerEvents = 'none';
        document.body.prepend(bgLayer);
    }

    if (config.backgroundUrl) {
        bgLayer.style.backgroundImage = `url('${config.backgroundUrl}')`;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundPosition = 'center';

        const b = config.bgBrightness || 100;
        const c = config.bgContrast || 100;
        const s = config.bgSaturate || 100;
        const bl = config.bgBlur || 0;

        bgLayer.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) blur(${bl}px)`;
    } else {
        bgLayer.style.backgroundImage = 'none';
        bgLayer.style.filter = 'none';
    }
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
    const socialWall = document.getElementById('social-wall');
    const slots = Array.from(socialWall.children);

    slots.forEach((div, i) => {
        const idInSlot = gridState[i];
        const currentId = div.getAttribute('data-id');

        if (idInSlot === currentId && idInSlot) {
            const img = div.querySelector('img');
            if (img) img.style.opacity = config.opacity;
            return; 
        }

        div.innerHTML = ''; 
        div.setAttribute('data-id', idInSlot || '');

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
                else if (config.animType === 'slide-up') transform = 'translateY(50px)';
                else if (config.animType === 'rotate') transform = 'rotate(-10deg)';
                
                img.style.transform = transform;

                div.appendChild(img);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        img.style.opacity = config.opacity; 
                        img.style.transform = 'scale(1) translateY(0) rotate(0)';
                    }); 
                });
            }
        }
    });
}

// --- FILA RIGOROSA ---
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

    let hasChanges = false;

    // 1. Limpeza (Isso acontece instantâneo pois é correção de erro)
    gridState = gridState.map(id => {
        if (id && !availableIds.has(id)) { hasChanges = true; return null; }
        return id; 
    });

    const usedIds = new Set(gridState.filter(id => id !== null));
    const hiddenImages = getHiddenImages();

    // 2. ORDENAÇÃO DA FILA: ANTIGAS PRIMEIRO (FIFO)
    const candidates = globalBackendImages
        .filter(img => !usedIds.has(img.id) && !hiddenImages.includes(img.id))
        .sort((a, b) => a.timestamp - b.timestamp);

    let emptyIndices = [];
    gridState.forEach((val, i) => { if (val === null) emptyIndices.push(i); });

    // 3. PREENCHE APENAS UM SLOT (Se houver vaga e candidato)
    if (emptyIndices.length > 0 && candidates.length > 0) {
        let targetIdx = emptyIndices[0];

        if (config.randomPosition) {
            const rnd = Math.floor(Math.random() * emptyIndices.length);
            targetIdx = emptyIndices[rnd];
        }

        // Pega o primeiro da fila (o mais antigo que ainda não apareceu)
        const img = candidates[0];
        gridState[targetIdx] = img.id;

        hasChanges = true;
        lastActivityTime = Date.now();
        console.log(`📸 Exibindo foto: ${img.id}`);
    }

    if (hasChanges) saveGridState(gridState);
    renderCurrentState(gridState, map);
}

// --- LOOP METRÔNOMO ---
function loopQueue() {
    if (!config.processing) return;

    // Executa um passo
    processQueueStep();

    // Limpa timeout anterior por segurança
    if (queueTimeoutId) clearTimeout(queueTimeoutId);

    // Define o próximo passo ESTRITAMENTE pelo intervalo configurado
    const delay = Math.max(500, config.processInterval);

    queueTimeoutId = setTimeout(loopQueue, delay);
}

async function init() {
    applyLayoutAndEffects();
    
    const poll = async () => { 
        try {
            const url = `${API_BASE_URL}?source=${config.sourceMode || 'local'}`;
            const res = await fetch(url);
            if (res.ok) globalBackendImages = await res.json();
        } catch (e) { } 
    };

    await poll();
    setInterval(poll, 3000); // Apenas atualiza os dados globais

    loopQueue(); // Inicia o relógio visual

    // Efeitos
    setInterval(() => {
        if (!config.processing) return;
        if (config.heroEnabled && (Date.now() - lastHeroTime > config.heroInterval * 1000)) {
            const slots = Array.from(document.getElementById('social-wall').children).filter(d => d.querySelector('img'));
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

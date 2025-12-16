import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import fetch from 'isomorphic-fetch';
import { Dropbox } from 'dropbox';
import sharp from 'sharp';
import chokidar from 'chokidar';
import multer from 'multer';
// import basicAuth from 'basic-auth'; // Descomente se instalar: npm install basic-auth

const __dirname = path.resolve();

// --- PASTAS ---
const PROCESSED_IMAGES_DIR = path.join(__dirname, 'processed-images');
const CAMERA_INPUT_DIR = path.join(__dirname, 'camera-input');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds');
const EXPORT_DIR = path.join(__dirname, 'exports');
const STATE_FILE = path.join(__dirname, 'wall-state.json'); // arquivo de backup

// Garante que as pastas existem
[PROCESSED_IMAGES_DIR, CAMERA_INPUT_DIR, BACKGROUNDS_DIR, EXPORT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

/* // Autenticação (Opcional)
const adminAuth = (req, res, next) => {
    if (req.method === 'GET' || 
        req.url.startsWith('/processed-images') || 
        req.url.startsWith('/backgrounds') || 
        req.url.startsWith('/exports') || 
        req.url === '/events' || 
        req.url === '/api/images' ||
        req.url === '/api/state') {
        return next();
    }
    const user = basicAuth(req);
    if (!user || user.name !== 'admin' || user.pass !== 'senha123') {
        res.set('WWW-Authenticate', 'Basic realm="Social Wall Admin"');
        return res.status(401).send('Acesso negado');
    }
    next();
};
app.use(adminAuth); 
*/

// --- CORREÇÃO CRÍTICA PARA O PRINT (CORS) ---
// Esse middleware força os headers que permitem que o html2canvas leia as imagens via AJAX/Canvas
const allowCrossDomain = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    next();
};

// Aplica a permissão ANTES de servir os arquivos estáticos
app.use('/processed-images', allowCrossDomain, express.static(PROCESSED_IMAGES_DIR));
app.use('/camera-input', allowCrossDomain, express.static(CAMERA_INPUT_DIR));
app.use('/backgrounds', allowCrossDomain, express.static(BACKGROUNDS_DIR));
app.use('/exports', allowCrossDomain, express.static(EXPORT_DIR));

// --- SSE (LOG PARA CLIENTES) ---
let sseClients = [];

// ROTA DE EVENTOS SSE
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('retry: 10000\n\n');

    const clientId = Date.now();
    sseClients.push({ id: clientId, res });

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
});


const wallSnapshotStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const base = (req.body.exportBaseFolder || '').trim() || 'wall-snapshots';
        const safeBase = base.replace(/[^a-z0-9_\-\/]/gi, '_');

        const dest = path.join(EXPORT_DIR, safeBase);
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const eventName = (req.body.eventName || 'evento')
            .toString()
            .trim()
            .replace(/[^a-z0-9_\-]/gi, '_');

        const ts = new Date().toISOString().replace(/[:.]/g, '-');

        cb(null, `${eventName || 'evento'}-wall-${ts}.png`);
    }
});


const uploadWallSnapshot = multer({ storage: wallSnapshotStorage });

// Função de log formatada para o admin.js
function logToClients(msg, type = 'log') {
    const time = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const payload = JSON.stringify({ msg, type, time });
    sseClients.forEach(c => c.res.write(`data: ${payload}\n\n`));
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

// --- HEALTHCHECK SIMPLES ---
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        time: new Date().toISOString()
    });
});

// --- OVERLAY DO NÚMERO DO GRID (SVG -> Buffer p/ sharp) ---
function createGridNumberOverlay(gridNumber) {
    const safeNumber = String(gridNumber);

    const svg = `
        <svg width="160" height="60" xmlns="http://www.w3.org/2000/svg">
            <style>
                text {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                }
            </style>
            <text x="20" y="40"
                  font-size="30"
                  fill="#ffffff"
                  fill-opacity="0.9"
                  stroke="#000000"
                  stroke-width="1.5"
                  paint-order="stroke">
                #${safeNumber}
            </text>
        </svg>
    `;

    return Buffer.from(svg);
}

// --- DROPBOX / MONITORAMENTO LONG POLLING COM RETRY AUTOMÁTICO ---
let dbxMonitorActive = false;
let currentDbxToken = null;

async function monitorDropbox(token, folderPath) {
    if (dbxMonitorActive && currentDbxToken === token) {
        logToClients('Monitor já está rodando.', 'system');
        return;
    }
    dbxMonitorActive = true;
    currentDbxToken = token;
    const dbx = new Dropbox({ accessToken: token, fetch: fetch });

    let pathFolder = (folderPath || '').trim();
    if (pathFolder === '/') {
        pathFolder = '';
    } else if (pathFolder && !pathFolder.startsWith('/')) {
        pathFolder = '/' + pathFolder;
    }

    logToClients(`🚀 Iniciando Monitor Dropbox (Long Polling) no caminho: ${pathFolder || '(Raiz)'}...`, 'system');

    let errorCount = 0;

    try {
        logToClients(`[DBX Debug] Obtendo cursor inicial para o caminho: '${pathFolder}'`, 'debug');

        let response = await dbx.filesListFolderGetLatestCursor({
            path: pathFolder,
            recursive: false
        });
        let cursor = response.result.cursor;

        const listRes = await dbx.filesListFolder({
            path: pathFolder,
            recursive: false
        });

        logToClients(`[DBX Debug] Encontrado ${listRes.result.entries.length} itens na primeira listagem.`, 'debug');

        await processEntries(dbx, listRes.result.entries);

        // Loop principal de monitoramento
        while (dbxMonitorActive && currentDbxToken === token) {
            try {
            // logToClients(`[DBX Debug] Iniciando Longpoll...`, 'debug');

                const pollResult = await dbx.filesListFolderLongpoll({
                    cursor: cursor,
                    timeout: 30
                });

                errorCount = 0;

                if (pollResult.result.changes) {
                    logToClients(`☁️ Alteração detectada no Dropbox!`, 'info');
                    let hasMore = true;
                    let listResult = await dbx.filesListFolderContinue({ cursor: cursor });

                    while (hasMore) {
                        logToClients(`[DBX Debug] Processando ${listResult.result.entries.length} alterações.`, 'debug');
                        await processEntries(dbx, listResult.result.entries);
                        hasMore = listResult.result.has_more;
                        cursor = listResult.result.cursor;
                        if (hasMore) {
                            listResult = await dbx.filesListFolderContinue({ cursor: cursor });
                        }
                    }
                } else {
                    if (pollResult.result.backoff) {
                        logToClients(
                            `Backoff solicitado. Aguardando ${pollResult.result.backoff}s.`,
                            'info'
                        );
                        await new Promise(r =>
                            setTimeout(r, pollResult.result.backoff * 1000)
                        );
                    }
                }
            } catch (pollError) {
                errorCount++;
                const waitTime = Math.min(60, errorCount * 5);

                console.error("Erro no polling do Dropbox:", pollError.message);
                logToClients(`⚠️ Erro conexão Dropbox (${errorCount}). Tentando reconectar em ${waitTime}s...`, 'warn');

                await new Promise(r => setTimeout(r, waitTime * 1000));
            }
        }
    } catch (error) {
        logToClients(`❌ Erro FATAL no Monitor Dropbox: ${error.message}`, 'error');
        dbxMonitorActive = false;
    }
}

async function processEntries(dbx, entries) {
    const imageEntries = entries.filter(
        e =>
            e['.tag'] === 'file' &&
            e.name.match(/\.(jpg|jpeg|png|gif|webp|heic)$/i)
    );

    if (imageEntries.length > 0) logToClients(`[DBX Debug] Arquivos de imagem novos: ${imageEntries.length}`, 'debug');

    for (const file of imageEntries) {
        try {
            const fileIdPart = file.id.replace(/[^a-zA-Z0-9]/gi, '');

            const existing = fs
                .readdirSync(PROCESSED_IMAGES_DIR)
                .find(f => f.includes(fileIdPart));

            if (existing) continue;

            const safeName = path
                .basename(file.name, path.extname(file.name))
                .replace(/[^a-z0-9]/gi, '_');
            const fileName = `dbx-${fileIdPart}-${Date.now()}-${safeName}${path.extname(
                file.name
            )}`;
            const outputPath = path.join(PROCESSED_IMAGES_DIR, fileName);

            logToClients(`[DBX] Baixando: ${file.name}...`, 'debug');

            const dl = await dbx.filesDownload({ path: file.path_lower });
            const buffer = dl.result.fileBinary;

            await sharp(buffer)
                .resize(800, 800, { fit: 'cover' })
                .toFile(outputPath);

            logToClients(
                `☁️ Dropbox: ${file.name} processada`,
                'success'
            );
        } catch (err) {
            logToClients(
                `❌ Erro ao processar arquivo do Dropbox (${file.name}): ${err.message}`,
                'error'
            );
        }
    }
}

// --- WATCHER DA PASTA CAMERA_INPUT ---
const watcher = chokidar.watch(CAMERA_INPUT_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000 }
});
watcher.on('add', async filePath => {
    const fileName = path.basename(filePath);
    if (!fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;
    try {
        const outputName = `local-${Date.now()}-${fileName}`;
        await sharp(filePath)
            .resize(800, 800, { fit: 'cover' })
            .toFile(path.join(PROCESSED_IMAGES_DIR, outputName));
        logToClients(`📸 Câmera: ${fileName}`, 'success');
        fs.unlinkSync(filePath);
    } catch (err) {
        logToClients(`Erro Câmera: ${err.message}`, 'error');
    }
});

// --- MULTER (UPLOAD) ---
const storagePhotos = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CAMERA_INPUT_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path
            .basename(file.originalname, ext)
            .replace(/[^a-z0-9]/gi, '_');
        cb(null, `local-upload-${Date.now()}-${name}${ext}`);
    }
});
const uploadPhotos = multer({
    storage: storagePhotos,
    limits: { fileSize: 20 * 1024 * 1024 }
});

const storageBg = multer.diskStorage({
    destination: (req, file, cb) => cb(null, BACKGROUNDS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `bg-${Date.now()}${ext}`);
    }
});
const uploadBg = multer({ storage: storageBg });

// --- ESTADO (ATÔMICO) ---
app.get('/api/state', (req, res) => {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            return res.json({ config: null, gridState: [], hiddenImages: [] });
        }
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.json({ config: null, gridState: [], hiddenImages: [] });
    }
});

app.post('/api/state', (req, res) => {
    try {
        const body = req.body || {};
        if (!body.config && !body.gridState) {
            return res.status(400).json({ error: "Estado vazio" });
        }

        const snapshot = {
            config: body.config || null,
            gridState: Array.isArray(body.gridState) ? body.gridState : [],
            hiddenImages: Array.isArray(body.hiddenImages) ? body.hiddenImages : []
        };

        const tempPath = path.join(path.dirname(STATE_FILE), `wall-state-${Date.now()}.tmp`);
        fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), 'utf8');
        fs.renameSync(tempPath, STATE_FILE);

        res.json({ success: true });
    } catch (e) {
        logToClients(`Erro ao salvar state: ${e.message}`, 'error');
        res.status(500).json({ success: false });
    }
});

// --- [NOVO] GERADOR DE SNAPSHOT VIA SERVER (COM FILTROS E OPACIDADE) ---
app.post('/api/generate-wall-snapshot', async (req, res) => {
    try {
        if (!fs.existsSync(STATE_FILE)) throw new Error("Sem estado salvo.");
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const { config, gridState } = state;

        if (!config || !gridState) throw new Error("Estado incompleto.");

        const W = parseInt(config.screenWidth) || 1920;
        const H = parseInt(config.screenHeight) || 1080;
        const cols = parseInt(config.cols) || 4;
        const rows = parseInt(config.rows) || 3;
        const gap = parseInt(config.gap) || 0;

        // Recupera filtros (0-100 no config -> normalizado para Sharp)
        const brightness = (config.bgBrightness ?? 100) / 100; // 1 = 100%
        const saturation = (config.bgSaturate ?? 100) / 100;   // 0 = P&B
        const contrast = (config.bgContrast ?? 100) / 100;     // 1 = normal
        const blurPx = (config.bgBlur ?? 0);
        // Opacidade das fotos (0 a 1)
        const photoOpacity = (config.opacity ?? 1);
        // Opacidade do overlay colorido (Tinta)
        const overlayStrength = (config.overlayStrength ?? 100) / 100;

        // 1. PREPARAR CAMADA BASE (P&B)
        // Isso simula o .image-container::before { filter: grayscale(1) ... }
        let bgBaseBuffer = null;
        let bgFilteredBuffer = null; // Para o overlay soft-light

        if (config.backgroundUrl) {
            const bgName = path.basename(config.backgroundUrl);
            const localBg = path.join(BACKGROUNDS_DIR, bgName);

            if (fs.existsSync(localBg)) {
                // Background Base (P&B Grayscale)
                // CSS: grayscale(1) contrast(1.05) brightness(0.9)
                bgBaseBuffer = await sharp(localBg)
                    .resize(W, H, { fit: 'cover' })
                    .grayscale() // Preto e branco
                    .linear(1.05, -(128 * 0.05)) // Contraste 1.05
                    .modulate({ brightness: 0.9 }) // Brightness 0.9
                    .toBuffer();

                // Background Colorido (para Overlay Soft-Light)
                // CSS: User Filters (Brightness, Contrast, Saturate, Blur)
                let bgPipe = sharp(localBg).resize(W, H, { fit: 'cover' });
                bgPipe = bgPipe.modulate({ brightness, saturation });
                if (contrast !== 1) bgPipe = bgPipe.linear(contrast, -(128 * (contrast - 1)));
                if (blurPx > 0) bgPipe = bgPipe.blur(0.3 + blurPx / 3);

                bgFilteredBuffer = await bgPipe.toBuffer();
            }
        }

        // Fallback se não tiver BG (cinza escuro)
        if (!bgBaseBuffer) {
            bgBaseBuffer = await sharp({
                create: { width: W, height: H, channels: 4, background: { r: 17, g: 24, b: 39, alpha: 1 } }
            }).png().toBuffer();
            // Se não tem imagem, o overlay colorido é só a cor de fundo
            bgFilteredBuffer = bgBaseBuffer;
        }

        // 2. CALCULAR E COMPOR SLOTS
        const totalGapW = Math.max(0, (cols - 1) * gap);
        const totalGapH = Math.max(0, (rows - 1) * gap);
        const slotW = Math.floor((W - totalGapW) / cols);
        const slotH = Math.floor((H - totalGapH) / rows);

        const composites = [];

        for (let i = 0; i < gridState.length; i++) {
            const imgId = gridState[i];
            if (!imgId) continue;

            const imgPath = path.join(PROCESSED_IMAGES_DIR, imgId);
            if (!fs.existsSync(imgPath)) continue;

            const col = i % cols;
            const row = Math.floor(i / cols);
            const left = col * (slotW + gap);
            const top = row * (slotH + gap);

            // A. FOTO COM OPACIDADE
            // Simula: img { opacity: config.opacity }
            let photoPipe = sharp(imgPath).resize(slotW, slotH, { fit: 'cover' });
            if (photoOpacity < 1) {
                const alphaVal = Math.floor(255 * photoOpacity);
                photoPipe = photoPipe.ensureAlpha().composite([{
                    input: Buffer.from([0, 0, 0, alphaVal]),
                    raw: { width: 1, height: 1, channels: 4 },
                    tile: true,
                    blend: 'dest-in'
                }]);
            }
            const photoBuf = await photoPipe.toBuffer();
            composites.push({ input: photoBuf, top, left });

            // B. OVERLAY "SOFT-LIGHT" (REVELAÇÃO TEXTURIZADA)
            // Simula: ::after { background-image: bg; filter: filters; mix-blend-mode: soft-light; opacity: overlayStrength }
            if (bgFilteredBuffer) {
                // Recorta o pedaço exato do BG colorido correspondente a este slot
                let overlayPipe = sharp(bgFilteredBuffer).extract({ left, top, width: slotW, height: slotH });

                // Aplica a opacidade do overlay (overlayStrength)
                if (overlayStrength < 1) {
                    const ovAlpha = Math.floor(255 * overlayStrength);
                    overlayPipe = overlayPipe.ensureAlpha().composite([{
                        input: Buffer.from([0, 0, 0, ovAlpha]),
                        raw: { width: 1, height: 1, channels: 4 },
                        tile: true,
                        blend: 'dest-in'
                    }]);
                }

                const overlayBuf = await overlayPipe.toBuffer();

                // Adiciona com blend mode soft-light
                composites.push({ input: overlayBuf, top, left, blend: 'soft-light' });
            }

            // C. NÚMERO
            if (config.showGridNumber) {
                const numSvg = createGridNumberOverlay(i + 1);
                composites.push({ input: numSvg, top: top + 5, left: left + 5 });
            }
        }

        // 3. FINALIZAR
        const filename = `server-snap-${Date.now()}.jpg`;
        const outPath = path.join(EXPORT_DIR, filename);

        // Usa o bgBaseBuffer (P&B) como base e aplica as camadas (Foto + Overlay SoftLight)
        await sharp(bgBaseBuffer)
            .composite(composites)
            .toFile(outPath);

        logToClients(`📸 Snapshot fiel gerado: ${filename}`, 'success');
        res.json({ success: true, url: `/exports/${filename}` });

    } catch (e) {
        logToClients(`Erro snapshot: ${e.message}`, 'error');
        res.status(500).json({ error: e.message });
    }
});

// --- ROTAS API ---

app.post('/api/upload-wall-snapshot', uploadWallSnapshot.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo recebido.' });

        const relativeFolder = path.relative(EXPORT_DIR, req.file.destination).replace(/\\/g, '/');
        const publicUrl = `/exports/${relativeFolder}/${req.file.filename}`;

        return res.json({ success: true, url: publicUrl });
    } catch (e) {
        console.error('[Wall Snapshot] Erro ao salvar snapshot:', e);
        return res.status(500).json({ success: false, error: 'Erro interno ao salvar snapshot.' });
    }
});

app.post('/api/upload', uploadPhotos.array('photos', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'Vazio' });

        for (const file of req.files) {
            const outputName = `local-${Date.now()}-${path.basename(file.filename)}`;
            await sharp(file.path).resize(800, 800, { fit: 'cover' }).toFile(path.join(PROCESSED_IMAGES_DIR, outputName));
            fs.unlinkSync(file.path);
        }

        logToClients(`📤 ${req.files.length} fotos enviadas via Admin`, 'success');
        res.status(200).json({ message: 'OK', count: req.files.length });
    } catch (error) {
        logToClients(`Erro Upload: ${error.message}`, 'error');
        res.status(500).json({ message: 'Erro' });
    }
});

app.post('/api/upload-bg', uploadBg.single('background'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Vazio' });
        const url = `http://localhost:${PORT}/backgrounds/${req.file.filename}`;
        logToClients(`🖼️ Novo background definido`, 'success');
        res.status(200).json({ url });
    } catch (error) {
        res.status(500).json({ message: 'Erro' });
    }
});

app.post('/api/dropbox/start', (req, res) => {
    const { token, folder } = req.body;
    if (token) {
        monitorDropbox(token, folder);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Token faltando' });
    }
});

app.get('/api/images', (req, res) => {
    const { source } = req.query;
    const prefix = source === 'dropbox' ? 'dbx-' : 'local-';
    try {
        const files = fs.readdirSync(PROCESSED_IMAGES_DIR)
            .filter(f => f.startsWith(prefix) && f.match(/\.(jpg|jpeg|png|gif|webp)$/i))
            .map(f => ({
                id: f,
                url: `http://localhost:${PORT}/processed-images/${f}`,
                timestamp: fs.statSync(path.join(PROCESSED_IMAGES_DIR, f)).mtimeMs
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
        res.json(files);
    } catch (e) {
        res.json([]);
    }
});

app.delete('/api/images/:filename', (req, res) => {
    try {
        const p = path.join(PROCESSED_IMAGES_DIR, req.params.filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        logToClients(`Arquivo removido: ${req.params.filename}`, 'warn');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Limpeza de inputs
app.post('/api/cleanup-processed', (req, res) => {
    try {
        const days = req.body.days || 1;
        const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
        let count = 0;
        fs.readdirSync(PROCESSED_IMAGES_DIR).forEach(file => {
            if (!file.match(/^(local-|dbx-).+\.(jpg|jpeg|png|webp)$/)) return;
            const full = path.join(PROCESSED_IMAGES_DIR, file);
            if (fs.statSync(full).mtimeMs < threshold) {
                fs.unlinkSync(full);
                count++;
            }
        });
        logToClients(`🧹 Limpeza Input: ${count} imagens removidas.`, 'warn');
        res.json({ success: true, count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// **ROTA DE EXPORTAÇÃO DE COLAGEM (SOUVENIR) - BLEND MANUAL + NÚMERO + FILTROS BG**
app.post('/api/export-collage', async (req, res) => {
    const {
        photoId,
        backgroundUrl,
        tile,
        exportSize,
        opacity,
        gridNumber: rawGridNumber,
        bgFilters,
        overlayStrength: rawOverlayStrength // <= vindo do admin / main / preview
    } = req.body;

    if (!photoId || !tile || !exportSize) {
        return res
            .status(400)
            .json({ message: 'Dados insuficientes para exportação.' });
    }

    // --- GRID NUMBER NORMALIZADO ---
    let gridNumber = rawGridNumber;
    if (gridNumber !== undefined && gridNumber !== null) {
        gridNumber = parseInt(gridNumber, 10);
        if (!Number.isFinite(gridNumber) || gridNumber <= 0) {
            gridNumber = null;
        }
    } else {
        gridNumber = null;
    }

    // --- TILE / LAYOUT ---
    let { row, col, cols, rows } = tile;
    cols = cols || 1;
    rows = rows || 1;

    // --- OPACIDADE DA FOTO (MESMO SLIDER DO ADMIN) ---
    let photoAlpha = opacity;
    if (typeof photoAlpha === 'string') photoAlpha = parseFloat(photoAlpha);
    if (!Number.isFinite(photoAlpha)) photoAlpha = 1;

    // aceita 0–1 ou 0–100
    if (photoAlpha > 1 && photoAlpha <= 100) photoAlpha = photoAlpha / 100;
    if (photoAlpha < 0) photoAlpha = 0;
    if (photoAlpha > 1) photoAlpha = 1;

    // --- FORÇA DO OVERLAY (NOVO SLIDER overlayStrength: 0–100) ---
    let overlayStrength = rawOverlayStrength;
    if (typeof overlayStrength === 'string') overlayStrength = parseFloat(overlayStrength);
    if (!Number.isFinite(overlayStrength)) overlayStrength = 100; // default: overlay cheio
    if (overlayStrength < 0) overlayStrength = 0;
    if (overlayStrength > 100) overlayStrength = 100;

    const overlayFactor = overlayStrength / 100;

    // quanto de "tinta" de fundo entra por cima da foto
    // regra: quanto menor a opacidade da foto, maior a intensidade da tinta
    // se opacity = 1  -> tintAlpha = 0 (sem overlay)
    // se opacity = 0.4 e overlayStrength = 100 -> tintAlpha = 0.6
    let tintAlpha = (1 - photoAlpha) * overlayFactor;
    if (tintAlpha < 0) tintAlpha = 0;
    if (tintAlpha > 1) tintAlpha = 1;

    // mistura de textura PB dentro da foto base (efeito "revelação texturizada")
    const grayMix = 0.2; // 20% de textura PB na foto

    // --- NORMALIZA FILTROS DE BG ---
    const brightnessPct = bgFilters?.brightness ?? 100;
    const contrastPct = bgFilters?.contrast ?? 100;
    const saturatePct = bgFilters?.saturate ?? 100;
    const blurPx = bgFilters?.blur ?? 0;

    const brightness = brightnessPct / 100;
    const saturation = saturatePct / 100;
    const contrast = contrastPct / 100;
    const blurSigma = blurPx > 0 ? blurPx / 2 : 0;

    try {
        const photoPath = path.join(PROCESSED_IMAGES_DIR, photoId);
        if (!fs.existsSync(photoPath)) {
            return res
                .status(404)
                .json({ message: 'Foto original não encontrada.' });
        }

        const targetW = exportSize.w || 1080;
        const targetH = exportSize.h || 1080;

        // --- CASO SEM BACKGROUND (SÓ A FOTO) ---
        if (!backgroundUrl) {
            let pipeline = sharp(photoPath).resize(targetW, targetH, {
                fit: 'cover'
            });

            if (gridNumber) {
                const overlay = createGridNumberOverlay(gridNumber);
                pipeline = pipeline.composite([
                    { input: overlay, top: 12, left: 12 }
                ]);
            }

            const finalBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();

            const filename = `${path.basename(
                photoId,
                path.extname(photoId)
            )}_export_${Date.now()}.jpg`;
            const finalPath = path.join(EXPORT_DIR, filename);
            fs.writeFileSync(finalPath, finalBuffer);

            return res.status(200).json({
                filename,
                url: `http://localhost:${PORT}/exports/${filename}`,
                backgroundUsed: false
            });
        }

        // --- COM BACKGROUND: PREPARA FOTO & BG EM RAW ---
        const { data: photoData, info: photoInfo } = await sharp(photoPath)
            .resize(targetW, targetH, { fit: 'cover' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        let bgSharp = null;
        const bgFilename = path.basename(backgroundUrl);
        const localBgPath = path.join(BACKGROUNDS_DIR, bgFilename);

        // tenta carregar o BG local; se não existir, tenta via URL (pode ser http://localhost ou remoto)
        try {
            if (fs.existsSync(localBgPath)) {
                bgSharp = sharp(localBgPath);
            } else {
                const resp = await fetch(backgroundUrl);
                if (resp.ok) {
                    const bgBuffer = Buffer.from(await resp.arrayBuffer());
                    bgSharp = sharp(bgBuffer);
                }
            }
        } catch (loadError) {
            logToClients(`Exportador: Erro ao carregar background: ${loadError.message}`, 'error');
        }

        // fallback se não conseguir o fundo
        if (!bgSharp) {
            logToClients('Exportador: Background não pôde ser carregado. Exportando apenas a foto (Fallback).', 'warn');
            let pipelineFallback = sharp(photoData, { raw: photoInfo });

            if (gridNumber) {
                const overlay = createGridNumberOverlay(gridNumber);
                pipelineFallback = pipelineFallback.composite([
                    { input: overlay, top: 12, left: 12 }
                ]);
            }

            const finalBuffer = await pipelineFallback
                .jpeg({ quality: 90 })
                .toBuffer();
            const filename = `${path.basename(photoId, path.extname(photoId))}_export_${Date.now()}.jpg`;
            const finalPath = path.join(EXPORT_DIR, filename);
            fs.writeFileSync(finalPath, finalBuffer);
            return res.status(200).json({
                filename,
                url: `http://localhost:${PORT}/exports/${filename}`,
                backgroundUsed: false
            });
        }

        const metadata = await bgSharp.metadata();
        const bgWidth = metadata.width;
        const bgHeight = metadata.height;

        const colClamped = Math.min(Math.max(col, 0), cols - 1);
        const rowClamped = Math.min(Math.max(row, 0), rows - 1);

        const tileWidth = Math.floor(bgWidth / cols);
        const tileHeight = Math.floor(bgHeight / rows);

        const extractLeft = colClamped * tileWidth;
        const extractTop = rowClamped * tileHeight;

        const extractWidth =
            colClamped === cols - 1 ? bgWidth - extractLeft : tileWidth;
        const extractHeight =
            rowClamped === rows - 1 ? bgHeight - extractTop : tileHeight;

        // --- APLICA FILTROS NO TILE DE BG ANTES DE IR PARA RAW ---
        let bgTileSharp = bgSharp
            .extract({
                left: extractLeft,
                top: extractTop,
                width: extractWidth,
                height: extractHeight
            })
            .resize(targetW, targetH, { fit: 'cover' })
            .removeAlpha();

        // modulate: brilho e saturação
        bgTileSharp = bgTileSharp.modulate({
            brightness,
            saturation
        });

        // contraste aproximado
        if (contrast !== 1) {
            bgTileSharp = bgTileSharp.linear(contrast, 128 * (1 - contrast));
        }

        // blur, se houver
        if (blurSigma > 0) {
            bgTileSharp = bgTileSharp.blur(blurSigma);
        }

        const { data: bgData, info: bgInfo } = await bgTileSharp
            .raw()
            .toBuffer({ resolveWithObject: true });

        // segurança: se por algum motivo o tamanho não bater, cai no fallback só com a foto
        if (
            bgInfo.width !== photoInfo.width ||
            bgInfo.height !== photoInfo.height
        ) {
            let pipelineFallback = sharp(photoData, { raw: photoInfo });

            if (gridNumber) {
                const overlay = createGridNumberOverlay(gridNumber);
                pipelineFallback = pipelineFallback.composite([
                    { input: overlay, top: 12, left: 12 }
                ]);
            }

            const finalBuffer = await pipelineFallback
                .jpeg({ quality: 90 })
                .toBuffer();
            const filename = `${path.basename(
                photoId,
                path.extname(photoId)
            )}_export_${Date.now()}.jpg`;
            const finalPath = path.join(EXPORT_DIR, filename);
            fs.writeFileSync(finalPath, finalBuffer);

            return res.status(200).json({
                filename,
                url: `http://localhost:${PORT}/exports/${filename}`,
                backgroundUsed: false
            });
        }

        // --- BLEND MANUAL FOTO + BACKGROUND (Revelação Texturizada) ---
        const channels = bgInfo.channels || 3;
        const length = bgData.length;
        const out = Buffer.alloc(length);

        for (let i = 0; i < length; i += channels) {
            const br = bgData[i];
            const bgc = bgData[i + 1];
            const bb = bgData[i + 2];

            const pr = photoData[i];
            const pg = photoData[i + 1];
            const pb = photoData[i + 2];

            // 1) Base PB: converte o pedaço do fundo para escala de cinza (textura)
            const gray = Math.round(br * 0.299 + bgc * 0.587 + bb * 0.114);

            // 2) "Foto + textura": mistura um pouco do PB na foto
            const texR = Math.round(pr * (1 - grayMix) + gray * grayMix);
            const texG = Math.round(pg * (1 - grayMix) + gray * grayMix);
            const texB = Math.round(pb * (1 - grayMix) + gray * grayMix);

            // 3) Cobertura colorida: fundo por cima com tintAlpha (controlado por opacity + overlayStrength)
            const r = Math.round(texR * (1 - tintAlpha) + br * tintAlpha);
            const g = Math.round(texG * (1 - tintAlpha) + bgc * tintAlpha);
            const b = Math.round(texB * (1 - tintAlpha) + bb * tintAlpha);

            out[i] = r;
            out[i + 1] = g;
            out[i + 2] = b;

            if (channels === 4) {
                out[i + 3] = 255; // garante opaco
            }
        }

        // monta imagem final a partir do buffer texturizado
        let pipelineFinal = sharp(out, { raw: bgInfo });

        if (gridNumber) {
            const overlay = createGridNumberOverlay(gridNumber);
            pipelineFinal = pipelineFinal.composite([
                { input: overlay, top: 12, left: 12 }
            ]);
        }

        const finalBuffer = await pipelineFinal
            .jpeg({ quality: 90 })
            .toBuffer();

        const filename = `${path.basename(
            photoId,
            path.extname(photoId)
        )}_export_${Date.now()}.jpg`;
        const finalPath = path.join(EXPORT_DIR, filename);
        fs.writeFileSync(finalPath, finalBuffer);

        res.status(200).json({
            filename,
            url: `http://localhost:${PORT}/exports/${filename}`,
            backgroundUsed: true
        });
    } catch (error) {
        logToClients('Exportador: Erro CRÍTICO na composição.', 'error');
        console.error(error);
        res
            .status(500)
            .json({ message: 'Erro na composição da imagem.' });
    }
});


// --- RELATÓRIO DE EXPORTS + CSV ---

function generateExportsReport() {
    try {
        const files = fs.readdirSync(EXPORT_DIR)
            .filter(f => f.match(/\.(jpg|jpeg|png|gif|webp|avif|bmp)$/i));

        if (!files.length) return [];

        const infos = files.map(filename => {
            const full = path.join(EXPORT_DIR, filename);
            const stats = fs.statSync(full);
            return {
                filename,
                mtimeMs: stats.mtimeMs,
                mtimeIso: stats.mtime.toISOString()
            };
        }).sort((a, b) => a.mtimeMs - b.mtimeMs);

        const total = infos.length;
        const firstExportAt = infos[0].mtimeIso;
        const lastExportAt = infos[total - 1].mtimeIso;

        let avgIntervalMs = 0;
        if (total > 1) {
            let sum = 0;
            for (let i = 1; i < total; i++) {
                sum += infos[i].mtimeMs - infos[i - 1].mtimeMs;
            }
            avgIntervalMs = sum / (total - 1);
        }

        // Gera CSV simples: filename,timestamp
        const csvLines = ['filename,timestamp'];
        infos.forEach(info => {
            csvLines.push(`${info.filename},${info.mtimeIso}`);
        });
        const csvPath = path.join(EXPORT_DIR, 'exports.csv');
        fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

        return [{
            folder: 'exports',
            totalExports: total,
            firstExportAt,
            lastExportAt,
            avgIntervalMs
        }];
    } catch (e) {
        logToClients(`Erro ao gerar relatório de exports: ${e.message}`, 'error');
        return [];
    }
}

app.get('/exports/events', (req, res) => {
    const summary = generateExportsReport();
    res.json(summary);
});

// --- RESET DE EVENTO (estado do mural) ---
app.post('/api/reset-event', (req, res) => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            fs.unlinkSync(STATE_FILE);
        }
        logToClients('🔄 Reset de evento solicitado pelo admin. Estado limpo.', 'system');
        res.json({ success: true });
    } catch (e) {
        logToClients(`Erro ao resetar evento: ${e.message}`, 'error');
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- LIMPEZA DE EXPORTS ANTIGOS ---
app.post('/exports/cleanup', (req, res) => {
    try {
        const body = req.body || {};
        const days = Number.isFinite(body.days) ? body.days : 1;
        const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

        const files = fs.readdirSync(EXPORT_DIR);
        let removed = 0;

        files.forEach(f => {
            const ext = path.extname(f).toLowerCase();
            if (!ext.match(/\.(jpg|jpeg|png|gif|webp|avif|bmp)$/i)) return;
            const full = path.join(EXPORT_DIR, f);
            const stats = fs.statSync(full);
            if (stats.mtimeMs < threshold) {
                fs.unlinkSync(full);
                removed++;
            }
        });

        logToClients(`🧹 Cleanup de exports: ${removed} arquivo(s) mais antigos que ${days} dia(s) foram removidos.`, 'system');
        res.json({ success: true, removed, days });
    } catch (e) {
        logToClients(`Erro no cleanup de exports: ${e.message}`, 'error');
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor ON: http://localhost:${PORT}`);
    logToClients(`Servidor iniciado na porta ${PORT}`, 'system');
});
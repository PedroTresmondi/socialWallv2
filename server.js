import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import fetch from 'isomorphic-fetch';
import { Dropbox } from 'dropbox';
import sharp from 'sharp';
import chokidar from 'chokidar';
import multer from 'multer';

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

// Servir arquivos estáticos
app.use('/processed-images', express.static(PROCESSED_IMAGES_DIR));
app.use('/camera-input', express.static(CAMERA_INPUT_DIR));
app.use('/backgrounds', express.static(BACKGROUNDS_DIR));
app.use('/exports', express.static(EXPORT_DIR));

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
// versão discreta: só texto, sem fundo
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

// --- DROPBOX / MONITORAMENTO LONG POLLING ---
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
    let pathFolder = folderPath === '/' ? '' : folderPath;
    if (pathFolder && !pathFolder.startsWith('/')) pathFolder = '/' + pathFolder;

    logToClients(`🚀 Iniciando Monitor Dropbox (Long Polling)...`, 'system');

    try {
        let response = await dbx.filesListFolderGetLatestCursor({
            path: pathFolder,
            recursive: false
        });
        let cursor = response.result.cursor;
        const listRes = await dbx.filesListFolder({
            path: pathFolder,
            recursive: false
        });
        await processEntries(dbx, listRes.result.entries);

        while (dbxMonitorActive && currentDbxToken === token) {
            const pollResult = await dbx.filesListFolderLongpoll({
                cursor: cursor,
                timeout: 30
            });
            if (pollResult.result.changes) {
                logToClients(`☁️ Alteração detectada no Dropbox!`, 'info');
                let hasMore = true;
                let listResult = await dbx.filesListFolderContinue({ cursor: cursor });

                while (hasMore) {
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
        }
    } catch (error) {
        logToClients(`❌ Erro no Monitor Dropbox: ${error.message}`, 'error');
        dbxMonitorActive = false;
    }
}

async function processEntries(dbx, entries) {
    const imageEntries = entries.filter(
        e =>
            e['.tag'] === 'file' &&
            e.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );
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

            const dl = await dbx.filesDownload({ path: file.path_lower });
            const buffer = dl.result.fileBinary;

            await sharp(buffer)
                .resize(800, 800, { fit: 'cover' })
                .toFile(outputPath);

            logToClients(
                `☁️ Dropbox: ${file.name} processada (ID: ${fileIdPart})`,
                'success'
            );
        } catch (err) {
            logToClients(
                `Erro ao processar arquivo do Dropbox (${file.name}): ${err.message}`,
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

// --- MULTER (UPLOAD DE FOTOS VIA ADMIN) ---
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
const uploadPhotos = multer({ storage: storagePhotos });

// MULTER (BACKGROUND)
const storageBg = multer.diskStorage({
    destination: (req, file, cb) => cb(null, BACKGROUNDS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `bg-${Date.now()}${ext}`);
    }
});
const uploadBg = multer({ storage: storageBg });

// --- BACKUP DE ESTADO (config + grid + bloqueados) ---
app.get('/api/state', (req, res) => {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            return res.json({
                config: null,
                gridState: [],
                hiddenImages: []
            });
        }
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        res.json(parsed);
    } catch (e) {
        logToClients(`Erro ao ler state: ${e.message}`, 'error');
        res.json({
            config: null,
            gridState: [],
            hiddenImages: []
        });
    }
});

app.post('/api/state', (req, res) => {
    try {
        const body = req.body || {};
        const snapshot = {
            config: body.config || null,
            gridState: Array.isArray(body.gridState) ? body.gridState : [],
            hiddenImages: Array.isArray(body.hiddenImages) ? body.hiddenImages : []
        };

        fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
        logToClients('💾 Estado do mural salvo em wall-state.json', 'system');
        res.json({ success: true });
    } catch (e) {
        logToClients(`Erro ao salvar state: ${e.message}`, 'error');
        res.status(500).json({ success: false });
    }
});

// --- ROTAS API BÁSICAS ---

// 1. Upload de fotos (Admin)
app.post('/api/upload', uploadPhotos.array('photos', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado' });
        }

        for (const file of req.files) {
            const tempFilepath = file.path;
            const outputName = `local-${Date.now()}-${path.basename(
                file.filename
            )}`;
            const outputpath = path.join(PROCESSED_IMAGES_DIR, outputName);

            await sharp(tempFilepath)
                .resize(800, 800, { fit: 'cover' })
                .toFile(outputpath);
            fs.unlinkSync(tempFilepath);
        }

        logToClients(
            `📤 ${req.files.length} fotos enviadas via Admin`,
            'success'
        );
        res.status(200).json({
            message: 'Upload concluído',
            count: req.files.length
        });
    } catch (error) {
        logToClients(`Erro Upload: ${error.message}`, 'error');
        res.status(500).json({ message: 'Erro' });
    }
});

// 2. Upload de BACKGROUND
app.post('/api/upload-bg', uploadBg.single('background'), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ message: 'Nenhum arquivo enviado' });
        const filename = req.file.filename;
        const url = `http://localhost:${PORT}/backgrounds/${filename}`;
        logToClients(`🖼️ Novo background definido: ${filename}`, 'success');
        res.status(200).json({ url });
    } catch (error) {
        logToClients(`Erro Upload BG: ${error.message}`, 'error');
        res.status(500).json({ message: 'Erro' });
    }
});

// 3. Iniciar monitor do Dropbox (usado pelo admin.js)
app.post('/api/dropbox/start', (req, res) => {
    const { token, folder } = req.body;
    if (token) {
        monitorDropbox(token, folder);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Token faltando' });
    }
});

// 4. Listar imagens para o admin/wall (source = 'dropbox' ou 'local')
app.get('/api/images', (req, res) => {
    const { source } = req.query;
    const prefix = source === 'dropbox' ? 'dbx-' : 'local-';
    try {
        const files = fs
            .readdirSync(PROCESSED_IMAGES_DIR)
            .filter(
                f =>
                    f.startsWith(prefix) &&
                    f.match(/\.(jpg|jpeg|png|gif|webp)$/i)
            )
            .map(f => ({
                id: f,
                url: `http://localhost:${PORT}/processed-images/${f}`,
                timestamp: fs.statSync(path.join(PROCESSED_IMAGES_DIR, f))
                    .mtimeMs
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
        res.json(files);
    } catch (e) {
        logToClients(`Erro ao listar imagens: ${e.message}`, 'error');
        res.json([]);
    }
});

// 5. Remover imagem (usado pelo admin para “tirar da fila”)
app.delete('/api/images/:filename', (req, res) => {
    try {
        const p = path.join(PROCESSED_IMAGES_DIR, req.params.filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        logToClients(`Arquivo removido: ${req.params.filename}`, 'warn');
        res.json({ success: true });
    } catch (e) {
        logToClients(`Erro ao remover arquivo: ${e.message}`, 'error');
        res.status(500).json({ error: e.message });
    }
});

// **ROTA DE EXPORTAÇÃO DE COLAGEM (SOUVENIR) - BLEND MANUAL + NÚMERO**
app.post('/api/export-collage', async (req, res) => {
    const {
        photoId,
        backgroundUrl,
        tile,
        exportSize,
        opacity,
        gridNumber: rawGridNumber
    } = req.body;

    if (!photoId || !tile || !exportSize) {
        return res
            .status(400)
            .json({ message: 'Dados insuficientes para exportação.' });
    }

    let gridNumber = rawGridNumber;
    if (gridNumber !== undefined && gridNumber !== null) {
        gridNumber = parseInt(gridNumber, 10);
        if (!Number.isFinite(gridNumber) || gridNumber <= 0) {
            gridNumber = null;
        }
    } else {
        gridNumber = null;
    }

    let { row, col, cols, rows } = tile;
    cols = cols || 1;
    rows = rows || 1;

    let alpha = opacity;

    if (typeof alpha === 'string') alpha = parseFloat(alpha);
    if (Number.isNaN(alpha)) alpha = 0.4;
    if (alpha > 1 && alpha <= 100) alpha = alpha / 100;
    if (alpha <= 0) alpha = 0.4;
    if (alpha > 1) alpha = 1;

    alpha = Math.min(alpha, 0.6);

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

        if (fs.existsSync(localBgPath)) {
            bgSharp = sharp(localBgPath);
        } else {
            const resp = await fetch(backgroundUrl);
            const bgBuffer = Buffer.from(await resp.arrayBuffer());
            bgSharp = sharp(bgBuffer);
        }

        if (!bgSharp) {
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

        const { data: bgData, info: bgInfo } = await bgSharp
            .extract({
                left: extractLeft,
                top: extractTop,
                width: extractWidth,
                height: extractHeight
            })
            .resize(targetW, targetH, { fit: 'cover' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

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

        // --- BLEND MANUAL FOTO + BACKGROUND ---
        const length = bgData.length;
        const out = Buffer.alloc(length);
        const invAlpha = 1 - alpha;

        for (let i = 0; i < length; i++) {
            const mixed = Math.round(
                bgData[i] * invAlpha + photoData[i] * alpha
            );
            out[i] = mixed;
        }

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

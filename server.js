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

app.get('/api/status', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

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

function logToClients(message, type = 'log') {
    const payload = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
    sseClients.forEach(c => c.res.write(`data: ${payload}\n\n`));
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// --- DROPBOX / MONITORAMENTO LONG POLLING ---
let dbxMonitorActive = false;
let currentDbxToken = null;

async function monitorDropbox(token, folderPath) {
    if (dbxMonitorActive && currentDbxToken === token) {
        logToClients("Monitor já está rodando.", 'system');
        return;
    }
    dbxMonitorActive = true;
    currentDbxToken = token;
    const dbx = new Dropbox({ accessToken: token, fetch: fetch });
    let pathFolder = folderPath === '/' ? '' : folderPath;
    if (pathFolder && !pathFolder.startsWith('/')) pathFolder = '/' + pathFolder;

    logToClients(`🚀 Iniciando Monitor Dropbox (Long Polling)...`, 'system');

    try {
        let response = await dbx.filesListFolderGetLatestCursor({ path: pathFolder, recursive: false });
        let cursor = response.result.cursor;
        const listRes = await dbx.filesListFolder({ path: pathFolder, recursive: false });
        await processEntries(dbx, listRes.result.entries);

        while (dbxMonitorActive && currentDbxToken === token) {
            const pollResult = await dbx.filesListFolderLongpoll({ cursor: cursor, timeout: 30 });
            if (pollResult.result.changes) {
                logToClients(`☁️ Alteração detectada no Dropbox!`, 'info');
                const listResult = await dbx.filesListFolderContinue({ cursor: cursor });
                await processEntries(dbx, listResult.result.entries);
                cursor = listResult.result.cursor;
            } else {
                if (pollResult.result.backoff) {
                    await new Promise(r => setTimeout(r, pollResult.result.backoff * 1000));
                }
            }
        }
    } catch (error) {
        logToClients(`❌ Erro no Monitor Dropbox: ${error.message}`, 'error');
        dbxMonitorActive = false;
    }
}

async function processEntries(dbx, entries) {
    const imageEntries = entries.filter(e => e['.tag'] === 'file' && e.name.match(/\.(jpg|jpeg|png|gif|webp)$/i));
    for (const file of imageEntries) {
        try {
            const existing = fs.readdirSync(PROCESSED_IMAGES_DIR)
                .find(f => f.includes(file.id));
            if (existing) continue;

            const dl = await dbx.filesDownload({ path: file.path_lower });
            const fileName = `dbx-${Date.now()}-${file.name.replace(/[^a-z0-9]/gi, '_')}`;
            const outputPath = path.join(PROCESSED_IMAGES_DIR, fileName);

            const buffer = dl.result.fileBinary;
            await sharp(buffer).resize(800, 800, { fit: 'cover' }).toFile(outputPath);

            logToClients(`☁️ Dropbox: ${file.name}`, 'success');
        } catch (err) {
            logToClients(`Erro ao processar arquivo do Dropbox: ${err.message}`, 'error');
        }
    }
}

// --- WATCHER DA PASTA CAMERA_INPUT ---
const watcher = chokidar.watch(CAMERA_INPUT_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000 }
});
watcher.on('add', async (filePath) => {
    const fileName = path.basename(filePath);
    if (!fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;
    try {
        const outputName = `local-${Date.now()}-${fileName}`;
        await sharp(filePath).resize(800, 800, { fit: 'cover' }).toFile(path.join(PROCESSED_IMAGES_DIR, outputName));
        logToClients(`📸 Câmera: ${fileName}`, 'success');
    } catch (err) {
        logToClients(`Erro Câmera: ${err.message}`, 'error');
    }
});

// --- MULTER (UPLOAD DE FOTOS VIA ADMIN) ---
const storagePhotos = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CAMERA_INPUT_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_');
        cb(null, `local-${Date.now()}-${name}${ext}`);
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

// --- ROTAS API BÁSICAS ---

// 1. Upload de fotos (Admin)
app.post('/api/upload', uploadPhotos.array('photos', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "Nenhum arquivo enviado" });
        }
        for (const file of req.files) {
            const filepath = file.path;
            const buffer = fs.readFileSync(filepath);
            await sharp(buffer).resize(800, 800, { fit: 'cover' }).toFile(filepath);
        }
        logToClients(`📤 ${req.files.length} fotos enviadas via Admin`, 'success');
        res.status(200).json({ message: "Upload concluído", count: req.files.length });
    } catch (error) {
        logToClients(`Erro Upload: ${error.message}`, 'error');
        res.status(500).json({ message: "Erro" });
    }
});

// 2. Upload de BACKGROUND
app.post('/api/upload-bg', uploadBg.single('background'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
        const filename = req.file.filename;
        const url = `http://localhost:${PORT}/backgrounds/${filename}`;
        logToClients(`🖼️ Novo background definido: ${filename}`, 'success');
        res.status(200).json({ url });
    } catch (error) {
        logToClients(`Erro Upload BG: ${error.message}`, 'error');
        res.status(500).json({ message: "Erro" });
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
        const files = fs.readdirSync(PROCESSED_IMAGES_DIR)
            .filter(f => f.startsWith(prefix) && f.match(/\.(jpg|jpeg|png|gif|webp)$/i))
            .map(f => ({
                id: f,
                url: `http://localhost:${PORT}/processed-images/${f}`,
                timestamp: fs.statSync(path.join(PROCESSED_IMAGES_DIR, f)).mtimeMs
            }))
            .sort((a, b) => a.timestamp - b.timestamp); // Antigos primeiro
        res.json(files);
    } catch (e) {
        res.json([]);
    }
});

// 5. Remover imagem (usado pelo admin para “tirar da fila”)
app.delete('/api/images/:filename', (req, res) => {
    try {
        const p = path.join(PROCESSED_IMAGES_DIR, req.params.filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// **ROTA DE EXPORTAÇÃO DE COLAGEM (SOUVENIR) - BLEND MANUAL**
app.post('/api/export-collage', async (req, res) => {
    const { photoId, backgroundUrl, tile, exportSize, opacity } = req.body;

    if (!photoId || !tile || !exportSize) {
        return res.status(400).json({ message: "Dados insuficientes para exportação." });
    }

    let { row, col, cols, rows } = tile;
    cols = cols || 1;
    rows = rows || 1;

    if (cols <= 0 || rows <= 0) {
        return res.status(400).json({ message: "Grid inválido (cols/rows)." });
    }

    // --- OPACIDADE DA FOTO ---
    let alpha = opacity;

    if (typeof alpha === 'string') alpha = parseFloat(alpha);
    if (Number.isNaN(alpha)) alpha = 0.4;
    if (alpha > 1 && alpha <= 100) alpha = alpha / 100;
    if (alpha <= 0) alpha = 0.4;
    if (alpha > 1) alpha = 1;

    // força um máximo pra garantir que o fundo apareça
    alpha = Math.min(alpha, 0.6);

    logToClients(`Exportador: opacity recebida=${opacity}, alpha usado=${alpha}`, 'log');

    try {
        const photoPath = path.join(PROCESSED_IMAGES_DIR, photoId);
        if (!fs.existsSync(photoPath)) {
            logToClients(`Exportador: Foto não encontrada: ${photoId}`, 'error');
            return res.status(404).json({ message: "Foto original não encontrada." });
        }

        const targetW = exportSize.w || 1080;
        const targetH = exportSize.h || 1080;

        // Se não tiver background, exporta só a foto redimensionada
        if (!backgroundUrl) {
            const finalBuffer = await sharp(photoPath)
                .resize(targetW, targetH, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toBuffer();

            const filename = `${path.basename(photoId, path.extname(photoId))}_export_${Date.now()}.jpg`;
            const finalPath = path.join(EXPORT_DIR, filename);
            fs.writeFileSync(finalPath, finalBuffer);

            logToClients(`Exportador: OK só foto -> ${filename}`, 'success');

            return res.status(200).json({
                filename,
                url: `http://localhost:${PORT}/exports/${filename}`,
                backgroundUsed: false
            });
        }

        // --- FOTO como RAW RGB ---
        const { data: photoData, info: photoInfo } = await sharp(photoPath)
            .resize(targetW, targetH, { fit: 'cover' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // --- CARREGA BACKGROUND ---
        let bgSharp = null;
        const bgFilename = path.basename(backgroundUrl);
        const localBgPath = path.join(BACKGROUNDS_DIR, bgFilename);

        if (fs.existsSync(localBgPath)) {
            bgSharp = sharp(localBgPath);
            logToClients(`Exportador: Usando background local: ${localBgPath}`, 'info');
        } else {
            try {
                logToClients(`Exportador: Tentando baixar background remoto: ${backgroundUrl}`, 'info');
                const resp = await fetch(backgroundUrl);
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status} ao baixar backgroundUrl`);
                }
                const arrayBuffer = await resp.arrayBuffer();
                const bgBuffer = Buffer.from(arrayBuffer);
                bgSharp = sharp(bgBuffer);
            } catch (remoteErr) {
                logToClients(
                    `Exportador: Falha ao baixar background remoto (${backgroundUrl}). Fallback para só foto. Erro: ${remoteErr.message}`,
                    'error'
                );
            }
        }

        if (!bgSharp) {
            // fallback só foto
            const finalBuffer = await sharp(photoData, {
                raw: {
                    width: photoInfo.width,
                    height: photoInfo.height,
                    channels: photoInfo.channels
                }
            })
                .jpeg({ quality: 90 })
                .toBuffer();

            const filename = `${path.basename(photoId, path.extname(photoId))}_export_${Date.now()}.jpg`;
            const finalPath = path.join(EXPORT_DIR, filename);
            fs.writeFileSync(finalPath, finalBuffer);

            logToClients(`Exportador: Sem background utilizável, exportando só foto -> ${filename}`, 'warn');

            return res.status(200).json({
                filename,
                url: `http://localhost:${PORT}/exports/${filename}`,
                backgroundUsed: false
            });
        }

        const metadata = await bgSharp.metadata();
        const bgWidth = metadata.width;
        const bgHeight = metadata.height;

        if (!bgWidth || !bgHeight) {
            logToClients(
                `Exportador: Metadata inválida do background. Exportando só foto.`,
                'warn'
            );

            const finalBuffer = await sharp(photoData, {
                raw: {
                    width: photoInfo.width,
                    height: photoInfo.height,
                    channels: photoInfo.channels
                }
            })
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

        // --- CALCULA TILE DO GRID ---
        const colClamped = Math.min(Math.max(col, 0), cols - 1);
        const rowClamped = Math.min(Math.max(row, 0), rows - 1);

        const tileWidth = Math.floor(bgWidth / cols);
        const tileHeight = Math.floor(bgHeight / rows);

        const extractLeft = colClamped * tileWidth;
        const extractTop = rowClamped * tileHeight;

        const extractWidth = (colClamped === cols - 1)
            ? (bgWidth - extractLeft)
            : tileWidth;
        const extractHeight = (rowClamped === rows - 1)
            ? (bgHeight - extractTop)
            : tileHeight;

        logToClients(
            `Exportador: BG=${bgWidth}x${bgHeight}, grid=${cols}x${rows}, tile(row,col)=(${rowClamped},${colClamped}), recorte=(${extractLeft},${extractTop},${extractWidth},${extractHeight})`,
            'log'
        );

        // --- TILE DO BACKGROUND como RAW RGB no mesmo tamanho da foto ---
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

        // --- VALIDA TAMANHO/CHANNELS ---
        if (
            bgInfo.width !== photoInfo.width ||
            bgInfo.height !== photoInfo.height ||
            bgInfo.channels !== photoInfo.channels
        ) {
            logToClients(
                `Exportador: Mismatch de dimensões/channels entre foto e background. Exportando só foto.`,
                'error'
            );

            const finalBuffer = await sharp(photoData, {
                raw: {
                    width: photoInfo.width,
                    height: photoInfo.height,
                    channels: photoInfo.channels
                }
            })
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

        // --- BLEND MANUAL: out = bg * (1 - alpha) + photo * alpha ---
        const length = bgData.length; // width * height * channels
        const out = Buffer.alloc(length);

        const invAlpha = 1 - alpha;

        for (let i = 0; i < length; i++) {
            const bgVal = bgData[i];
            const photoVal = photoData[i];
            const mixed = Math.round(bgVal * invAlpha + photoVal * alpha);
            out[i] = mixed;
        }

        // --- GERA JPEG FINAL A PARTIR DO RAW ---
        const finalBuffer = await sharp(out, {
            raw: {
                width: bgInfo.width,
                height: bgInfo.height,
                channels: bgInfo.channels
            }
        })
            .jpeg({ quality: 90 })
            .toBuffer();

        const filename = `${path.basename(photoId, path.extname(photoId))}_export_${Date.now()}.jpg`;
        const finalPath = path.join(EXPORT_DIR, filename);
        fs.writeFileSync(finalPath, finalBuffer);

        logToClients(
            `Exportador: OK (blend manual) -> ${filename} (fundo usado: sim, alpha=${alpha})`,
            'success'
        );

        res.status(200).json({
            filename,
            url: `http://localhost:${PORT}/exports/${filename}`,
            backgroundUsed: true
        });
    } catch (error) {
        console.error('ERRO COMPOSIÇÃO:', error);
        logToClients('Exportador: Erro CRÍTICO na composição.', 'error');
        res.status(500).json({ message: 'Erro na composição da imagem.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor ON: http://localhost:${PORT}`);
    logToClients(`Servidor iniciado na porta ${PORT}`, 'system');
});

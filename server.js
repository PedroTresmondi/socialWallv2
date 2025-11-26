import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import fetch from 'isomorphic-fetch';
import { Dropbox } from 'dropbox';
import sharp from 'sharp';
import chokidar from 'chokidar';
import multer from 'multer';

const PORT = 3000;
const app = express();
const __dirname = path.resolve(); 

// --- PASTAS ---
const PROCESSED_IMAGES_DIR = path.join(__dirname, 'processed-images');
const CAMERA_INPUT_DIR = path.join(__dirname, 'camera-input');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds'); // NOVA PASTA

app.use(cors());
app.use(express.json());

// Garante que as pastas existem
if (!fs.existsSync(PROCESSED_IMAGES_DIR)) fs.mkdirSync(PROCESSED_IMAGES_DIR, { recursive: true });
if (!fs.existsSync(CAMERA_INPUT_DIR)) fs.mkdirSync(CAMERA_INPUT_DIR, { recursive: true });
if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });

// Servir arquivos estáticos
app.use('/processed-images', express.static(PROCESSED_IMAGES_DIR));
app.use('/backgrounds', express.static(BACKGROUNDS_DIR)); // Servir Backgrounds

// --- CONFIG MULTER (FOTOS DO MURAL) ---
const storagePhotos = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PROCESSED_IMAGES_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_');
        cb(null, `local-${Date.now()}-${name}${ext}`);
    }
});
const uploadPhotos = multer({ storage: storagePhotos });

// --- CONFIG MULTER (BACKGROUNDS) ---
const storageBg = multer.diskStorage({
    destination: (req, file, cb) => cb(null, BACKGROUNDS_DIR),
    filename: (req, file, cb) => {
        // Sobrescreve sempre ou cria novo? Vamos criar novo com timestamp para evitar cache
        const ext = path.extname(file.originalname);
        cb(null, `bg-${Date.now()}${ext}`); 
    }
});
const uploadBg = multer({ storage: storageBg });

// --- LOGS SSE ---
let clients = [];
function logToClients(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logData = JSON.stringify({ time: timestamp, msg: message, type });
    console.log(`[${type.toUpperCase()}] ${message}`);
    clients.forEach(c => c.write(`data: ${logData}\n\n`));
}
app.get('/api/status', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache' });
    const client = res;
    clients.push(client);
    req.on('close', () => clients = clients.filter(c => c !== client));
});

// --- ROTAS DE UPLOAD ---

// 1. Upload de FOTOS
app.post('/api/upload', uploadPhotos.array('photos', 20), async (req, res) => {
    try {
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

// 2. Upload de BACKGROUND (NOVO)
app.post('/api/upload-bg', uploadBg.single('background'), async (req, res) => {
    try {
        const file = req.file;
        // URL acessível do background
        const bgUrl = `http://localhost:${PORT}/backgrounds/${file.filename}`;
        logToClients(`🖼️ Novo Background Definido`, 'success');
        res.status(200).json({ url: bgUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erro ao salvar background" });
    }
});

// --- MONITORAMENTO DROPBOX (LONG POLLING) ---
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
    let path = folderPath === '/' ? '' : folderPath;
    if (path && !path.startsWith('/')) path = '/' + path;

    logToClients(`🚀 Iniciando Monitor Dropbox (Long Polling)...`, 'system');

    try {
        let response = await dbx.filesListFolderGetLatestCursor({ path: path, recursive: false });
        let cursor = response.result.cursor;
        const listRes = await dbx.filesListFolder({ path: path, recursive: false });
        await processEntries(dbx, listRes.result.entries);

        while (dbxMonitorActive && currentDbxToken === token) {
            const pollResult = await dbx.filesListFolderLongpoll({ cursor: cursor, timeout: 30 });
            if (pollResult.result.changes) {
                logToClients(`☁️ Alteração detectada no Dropbox!`, 'info');
                const listResult = await dbx.filesListFolderContinue({ cursor: cursor });
                await processEntries(dbx, listResult.result.entries);
                cursor = listResult.result.cursor;
            } else {
                if (pollResult.result.backoff) await new Promise(r => setTimeout(r, pollResult.result.backoff * 1000));
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
        const localName = `dbx-${file.name}`;
        const localPath = path.join(PROCESSED_IMAGES_DIR, localName);
        if (!fs.existsSync(localPath)) {
            logToClients(`⬇️ Baixando: ${file.name}`, 'success');
            const dl = await dbx.filesDownload({ path: file.path_lower });
            await sharp(Buffer.from(dl.result.fileBinary, 'binary')).resize(800, 800, { fit: 'cover' }).toFile(localPath);
        }
    }
}

// --- WATCHER LOCAL ---
const watcher = chokidar.watch(CAMERA_INPUT_DIR, { ignored: /(^|[\/\\])\../, persistent: true, awaitWriteFinish: { stabilityThreshold: 2000 } });
watcher.on('add', async (filePath) => {
    const fileName = path.basename(filePath);
    if (!fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;
    try {
        const outputName = `local-${Date.now()}-${fileName}`;
        await sharp(filePath).resize(800, 800, { fit: 'cover' }).toFile(path.join(PROCESSED_IMAGES_DIR, outputName));
        logToClients(`📸 Câmera: ${fileName}`, 'success');
    } catch (err) { logToClients(`Erro Câmera: ${err.message}`, 'error'); }
});

// --- ROTAS API ---
app.post('/api/dropbox/start', (req, res) => {
    const { token, folder } = req.body;
    if (token) { monitorDropbox(token, folder); res.json({ success: true }); }
    else { res.status(400).json({ error: 'Token faltando' }); }
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
            .sort((a, b) => a.timestamp - b.timestamp); // Antigos primeiro
        res.json(files);
    } catch (e) { res.json([]); }
});

app.delete('/api/images/:filename', (req, res) => {
    try {
        const p = path.join(PROCESSED_IMAGES_DIR, req.params.filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`🚀 Servidor ON: http://localhost:${PORT}`));
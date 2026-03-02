# Social Wall – Mural de Fotos com Export de Souvenirs

Mural de fotos em tempo real para eventos, integrado com Dropbox e câmera local, com:

- **Grid dinâmico** que se adapta ao número de fotos ou ao tamanho desejado  
- **Background personalizado** com filtros (brilho, contraste, saturação, blur)  
- **Export automático de “souvenirs”**: cada foto é salva com o recorte exato do fundo atrás dela  
- **Painel Admin** para controlar tudo em tempo real  
- **Backup de estado** para não perder mural/config em caso de queda de energia  

---

## 🔧 Stack & Arquitetura

**Backend (`server.js`)**

- Node.js + Express
- `sharp` para processamento de imagens
- Integração com **Dropbox** (`dropbox`, `isomorphic-fetch`)
- Monitoramento de pasta local via `chokidar`
- Upload via `multer`
- Log em tempo real via **SSE** (`/events`)
- Pastas principais:
  - `processed-images/` – fotos tratadas e prontas para o mural  
  - `camera-input/` – entrada da câmera / uploads crus  
  - `backgrounds/` – imagens de fundo  
  - `exports/` – souvenirs gerados  
  - `wall-state.json` – backup do estado (config + grid + bloqueados)

**Frontend**

- Módulos JS: `main.js`, `admin.js`, `shared.js`
- Estilos em `style.css` (Tailwind + custom)
- Dois modos principais:
  - **Wall** – tela cheia, só o mural
  - **Admin** – painel de configuração / operação

---

## Funcionalidades

### 1. Fontes de Imagem

- **Dropbox**
  - Monitoramento via long-polling (`filesListFolderLongpoll`)
  - Rota: `POST /api/dropbox/start`
    - Body: `{ "token": "<DROPBOX_TOKEN>", "folder": "/pasta" }`
  - Novas imagens são baixadas, redimensionadas (800x800) e salvas em `processed-images/` com prefixo `dbx-`.

- **Câmera / Pasta Local**
  - Watcher em `camera-input/` (via `chokidar`)
  - Ao detectar novo arquivo:
    - Redimensiona para 800x800
    - Salva em `processed-images/` com prefixo `local-`
    - Apaga o arquivo original

- **Upload Manual (Admin)**
  - Rota: `POST /api/upload` (campo `photos` – multipart)
  - Admin consegue subir fotos direto do painel.

---

### 2. Mural (Wall)

Controlado principalmente por `main.js`:

- **Modos de Layout**
  - `manual` – `cols` e `rows` definidos fixos
  - `auto-fit` – calcula colunas/linhas em cima de `photoWidth` e `photoHeight`
  - `target` – você define um alvo de quantidade de fotos (ex: 20) e ele calcula um grid "bonito"
  - `fit-all` – tenta encaixar **todas** as fotos disponíveis na tela, ajustando o grid conforme o volume

- **Grid & Slots**
  - Cada slot é uma `.image-container`
  - Tamanhos e espaçamento controlados por:
    - `cols`, `rows`
    - `gap` (espaço entre fotos)
    - `photoWidth`, `photoHeight` (no modo auto-fit)

- **Efeito Hero**
  - De tempos em tempos, uma foto é destacada:
    - `heroEnabled`, `heroInterval`
    - Classe `hero-active` com zoom, sombra e borda

- **Modo Remoção**
  - Quando ativado, o clique em um slot limpa a foto daquele grid
  - Visual com ícone de 🗑️ ao passar o mouse
  - Estado é refletido no `gridState` e persistido (se `persistGrid` ativo)

- **Fila de Processamento**
  - As fotos disponíveis são mantidas em `globalBackendImages`
  - `processQueueStep()` escolhe qual slot preencher a cada ciclo
  - Controle de:
    - `processing` (on/off)
    - `processInterval` (em segundos)
    - `randomPosition` (posição aleatória vs primeiro slot livre)

---

### 3. Background & Aparência

- Upload de background via:
  - `POST /api/upload-bg` → salva em `backgrounds/` e retorna URL
- Configs visuais (armazenadas em `config`):
  - `backgroundUrl`
  - `imageOpacity` (opacidade das fotos)
  - `bgBrightness` (%)
  - `bgContrast` (%)
  - `bgSaturate` (%)
  - `bgBlur` (px)
- No **Wall**, o background é aplicado no `body` e os filtros são refletidos tanto:
  - Na renderização ao vivo
  - **Quanto nos exports** (servidor aplica os mesmos filtros via `sharp`)

---

### 4. Export de Souvenirs

Quando uma foto entra no mural, `main.js` chama:

- `POST /api/export-collage`

Body (simplificado):

```json
{
  "photoId": "arquivo-da-foto.jpg",
  "backgroundUrl": "http://localhost:3000/backgrounds/bg-....jpg",
  "tile": { "row": 0, "col": 1, "cols": 6, "rows": 4 },
  "exportSize": { "w": 1080, "h": 1080 },
  "opacity": 0.4,
  "gridNumber": 12,
  "bgFilters": {
    "brightness": 100,
    "contrast": 100,
    "saturate": 100,
    "blur": 0
  }
}
```

---

## Deploy

- **Servidor (Node):** use variáveis de ambiente:
  - `PORT` – porta (padrão `3000`)
  - `BASE_URL` – URL pública do servidor (ex.: `https://wall.seudominio.com`), usada nas respostas da API
  - `CORS_ORIGIN` – origem permitida para CORS (ex.: `https://admin.seudominio.com` ou `*`); omitir = aceita qualquer origem
- **Frontend (Wall e Admin):** em outro domínio/porta, defina a base do backend antes de carregar o app, por exemplo em `index.html` e `admin.html`:
  ```html
  <script>window.__SOCIAL_WALL_API__ = 'https://wall.seudominio.com';</script>
  ```
  Assim as chamadas de API e o SSE usam essa URL.
- **Telão:** abra a Wall com `?tela=1` para entrar em tela cheia e ativar Wake Lock (evita o monitor desligar).

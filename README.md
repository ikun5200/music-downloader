# 飞牛音源下载站

自托管的音乐搜索 / 下载站：搜索酷我、酷狗、QQ、网易云、咪咕，自动选择可用音源渠道，按最高可用音质下载到 NAS 指定目录，并对外提供洛雪（LX Music）兼容 API。

- Next.js 15 + React 19 + Tailwind CSS
- Prisma + SQLite（单容器，无需 Redis/Postgres）
- 音源脚本运行在独立 worker 线程 + `vm` 沙箱内
- ffprobe 完整校验，自动识别错歌、占位音频和音质虚标
- Docker 多阶段构建，支持 x86_64 NAS

## 功能

- 5 平台聚合搜索，结果按原唱/相关度排序，过滤明显的翻唱、伴奏、DJ 版本降权。
- 批量下载模式：点击搜索框旁的批量按钮，一行一首歌（如 `愿与愁 林俊杰`），提交后由服务端后台逐条搜索、选版并入队；关闭浏览器或刷新页面都不会中断，重新打开会自动接上最新进度。
- 批量任务可暂停、继续、取消，面板实时显示选版进度、下载进度和每条歌曲的下载百分比；暂停/继续/取消会联动对应的下载任务。
- 选版算法：先硬过滤翻唱、伴奏、组曲、串烧、对唱改编、MV 首播、Live、DJ/Remix、剪辑试听等变体，再按标题/歌手匹配、时长一致性、渠道与音质打分；找不到匹配项时宁可失败，也不下载错歌。
- 可选 AI 选版：在后台设置中填入任意 OpenAI 兼容 API（Base URL / 模型 / Key）。规则匹配成功时 AI 复核短名单；规则匹配失败时把完整搜索结果交给 AI 判断。AI 明确判定“没有原版”或 AI 不可用且规则失败时，该条不下载，而不是硬塞变体。
- 自动选渠道：后台排序（首次启动按实测推荐初始化）> 全局优先级 > 成功率 > 延迟。
- 音质自动降级与回退：母带 / 24bit / Hi-Res > FLAC > 320k > 192k > 128k。
- 同一首歌会依次尝试多个渠道和多个音质档位，只有实际音质达标才落盘；不达标时保留“最佳可用”文件并标记为降级，而不是把 128k 冒充 FLAC。
- 下载前 Range 预检音频头，下载后 ffprobe 校验编码、码率、位深、时长。
- 错歌检测：标题/歌手/时长比对，识别防盗链占位、TTS、错歌。
- 点击搜索结果即可试听：服务端解析出低码率音源，经签名代理转发（带 Referer/UA、支持 Range 拖动），浏览器不会直接碰音源 CDN；底部有全局播放器，支持切歌、暂停、拖动进度、关闭。无封面的歌曲会显示音符占位图标，不会出现破图。
- 下载队列、并发控制、SSE 实时进度、取消、重试、删除；历史默认加载最近 100 条，超过可点“加载更多”，SSE 只做增量合并，不会把已加载的历史覆盖成 60 条。
- 批量任务与普通下载任务分开记录：下载页可查看最近批量任务的逐条结果、选版理由、AI 标记，并可取消或删除记录（不会删除已下载文件）。
- 后台上传 / 启用 / 禁用 / 排序 / 测试音源，查看平台、音质、初始化日志和渠道健康度。
- 后台设置 AI 选版（API Key 使用 AES-256-GCM 加密存储，页面只显示“已配置”），提供“测试 AI”按钮。
- API Token 管理；生成可在线导入洛雪的自定义源脚本。

## 快速开始（Docker）

### 1. 准备配置

```bash
cd music-downloader
cp .env.example .env
```

编辑 `.env`：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=换成一个强密码
AUTH_SECRET=用下面的命令生成
PUBLIC_BASE_URL=http://你的NAS内网IP:3000
HOST_DOWNLOAD_DIR=/vol1/1000/音乐/downloads
PUID=1000
PGID=1000
```

生成会话密钥：

```bash
openssl rand -hex 32
```

> 示例值不能直接启动：`ADMIN_PASSWORD` 仍是 `admin123` / `change-me-please`，或 `AUTH_SECRET` 仍是 `CHANGE_ME` 时，容器会拒绝启动并提示修改。

修改 `docker-compose.yml` 中的宿主机音乐目录：

```yaml
volumes:
  - "/vol1/1000/音乐/downloads:/downloads"
```

下载根目录是 `/vol1/1000/音乐/downloads`，容器内固定为 `/downloads`。文件会直接放在这个目录下，不再创建歌手/专辑子文件夹。`HOST_DOWNLOAD_DIR` 只用于在页面显示宿主机真实路径，请与 volumes 左侧保持一致。

### 2. 设置目录权限

容器默认以 `node` 用户运行（UID/GID 默认 1000）。确保宿主机音乐目录对 `PUID:PGID` 可写：

```bash
mkdir -p data "/vol1/1000/音乐/downloads"
sudo chown -R 1000:1000 data
# 只改下载目录本身的属主，避免递归修改整个音乐库
sudo chown 1000:1000 "/vol1/1000/音乐/downloads"
```

如果你的 NAS 用户不是 1000，请把 `.env` 里的 `PUID` / `PGID` 改成 `id -u` / `id -g` 的结果。

### 3. 启动

镜像由 GitHub Actions 构建并推送到 GHCR，NAS 直接拉取：

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

如果要从本地源码构建：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

首次启动会自动执行 `prisma migrate deploy` 初始化 SQLite 并启动下载队列。

> 仓库和镜像**不包含任何音源脚本**。首次部署后，请登录后台 →「音源渠道」上传你有权使用的洛雪（LX）音源 `.js` 文件，然后在「设置 → 平台与音源优先级」里调整顺序。

访问 `http://你的NAS内网IP:3000`，点击右上角“后台”，使用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

### 4. 升级

```bash
docker compose pull
docker compose up -d
```

数据库迁移会在容器启动时自动执行。`./data` 目录保存数据库和上传的音源脚本，升级不会丢失；建议定期备份。

NAS 上只需要保留：

```text
music-downloader/
├── docker-compose.yml
├── .env
├── data/          # SQLite、音源脚本、临时文件
└── README.md      # 可选
```

源码、`node_modules`、`.next` 都在镜像里，不需要放到 NAS。

## GitHub Actions 镜像

- 工作流：`.github/workflows/docker-publish.yml`
- 触发：推送到 `main`、推送 `v*` 标签，或手动 `workflow_dispatch`
- 镜像：`ghcr.io/ikun5200/music-downloader:latest`，同时生成 `sha-xxxxxxx` 标签
- 构建平台：`linux/amd64`，适配飞牛 NAS
- 工作流使用 `GITHUB_TOKEN` 推送到 GHCR，并在主分支构建后尝试把包设为 public；如果仍是 private，需要在 GitHub Package 设置里改为 public，或在 NAS 上 `docker login ghcr.io` 后拉取
- 镜像**不包含**任何音源脚本、推荐名单或 API Key；音源由管理员在后台自行上传到 `data/sources`

从源码本地构建（不使用 GHCR）：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## 音源与优先级

仓库和镜像不包含任何音源脚本、音源推荐名单或第三方密钥。部署后在后台「音源渠道」上传你有权使用的洛雪（LX）音源 `.js` 文件，然后到「设置 → 平台与音源优先级」配置：

- **音乐平台优先级**：调整酷我、酷狗、QQ、网易云、咪咕的顺序。影响搜索结果中各平台的展示顺序，以及批量自动选版时同分候选的平台偏好。
- **音源优先级**：按平台分别调整音源顺序，越靠前越优先；禁用的音源不会参与自动选择。
- 「音源渠道」页的上移/下移是全局音源顺序，会覆盖各平台的自定义顺序。

渠道连续失败 3 次会冷却 5 分钟；冷却中的渠道不会参与自动选择。

## 下载策略

1. 创建任务时记录请求音质（默认“最高可用”）。
2. 按音质档位从高到低、渠道按优先级尝试。
3. 解析出 URL 后先用 Range 拉取前 128KB 检查音频头，拒绝 HTML/JSON/防盗链页面。
4. 流式下载到 `data/tmp/*.part`，支持进度、取消、大小上限。
5. ffprobe 读取实际编码、位深、采样率、码率、时长。
6. 校验标题/歌手/时长；可疑文件自动换渠道。
7. 若实际音质低于当前档位，暂存为候选，继续尝试其他渠道和更低档位，最后取实际音质最高的候选；任务会标记 `downgraded` 并显示“请求 X，实际最高可用 Y”。
8. 文件名默认：`歌曲名.扩展名`，例如 `晴天.flac`，直接放在下载根目录，不创建子文件夹，也不添加歌手/音质等信息；重名时自动加 `(2)`。可在后台设置中修改模板。

## 批量下载与 AI 选版

批量任务提交到 `/api/batches` 后写入 SQLite，由服务端队列在后台执行，不依赖浏览器。容器重启时，未完成的批量任务会自动恢复：`running` 回到 `queued`，处理中的条目回到 `pending`。

批量面板有两条进度条：**选版**（已处理/总数）和**下载**（已完成 + 进行中的实际进度，分母同样是批次总数；失败/取消不计入进度）。这样下载条不会超过选版条，数量与百分比一致。每个条目显示排队、解析、下载百分比、已完成、已暂停或失败，并按最近更新时间倒序排列，最新处理的条目在最上面。支持暂停、继续、取消：

- **暂停**：停止继续选版；排队中的下载标记为已暂停；正在下载的任务会被中止（临时文件丢弃），继续时从头下载。
- **继续**：剩余条目继续选版，已暂停的下载重新排队。
- **取消**：未选版的条目标记取消，排队/暂停/正在下载的任务全部取消；已完成的文件保留。
- “选版完成”只表示选版阶段结束，下载可能仍在进行；此时仍可暂停或取消。

每条歌曲的选版流程：

1. 5 平台聚合搜索，先按标题/歌手把查询拆成关键词。
2. 硬过滤明显不是原版的条目：翻唱、Cover、伴奏、纯音乐、钢琴/吉他/古筝等演奏版、组曲、串烧、对唱改编、Remix/DJ、Live/现场/演唱会、MV 首播、铃声、片段、试听、0.8x/加速/降调等。
3. 对剩余候选打分：标题匹配（90）、歌手匹配（80）、标题完全一致（+30）、标题多余内容扣分、合集/电台类歌手扣分、时长偏离中位数扣分，渠道与音质作为同分时的排序依据。
4. 若后台启用了 AI，规则匹配成功时，把通过硬过滤的前 12 个候选（含平台、标题、歌手、专辑、时长、分数）发给 OpenAI 兼容接口复核；规则匹配失败时，不再强行套用规则，而是把**完整搜索结果**（包括被规则判为变体的候选）发给 AI，让 AI 判断是否存在原版。
5. AI 返回 `{"index": n, "reason": "..."}` 时使用对应候选；返回 `{"index": -1}` 表示确实没有原版，该条标记失败并提示“AI 判断没有原版，未下载”。AI 未配置或接口失败时回退规则结果；规则也失败则该条不下载。

AI 配置位于「后台 → 设置 → AI 选版」：

- Base URL：例如 `https://api.openai.com/v1`，也支持兼容 `/chat/completions` 的服务；填到 `/v1` 即可。
- 模型：例如 `gpt-4o-mini`，或兼容服务提供的模型名。
- API Key：保存后使用 `AUTH_SECRET` 派生的密钥做 AES-256-GCM 加密，页面不会回显明文；留空保存表示保持原 Key 不变，点“清除 Key”可删除已保存的 Key。
- 「测试 AI」会先保存当前填写的地址/模型/Key，再发送一个极小的 JSON 请求，验证地址、模型和 Key 是否可用。

关闭 AI 后完全走本地规则，不产生任何外部请求。

## 在线试听

搜索页点击歌曲行、封面或「试听」按钮即可播放：

- 服务端会按 `128k → 320k → 192k → FLAC` 的顺序解析，优先低码率保证快速起播。
- 浏览器播放的是本站的签名代理地址 `/api/preview/stream?t=...`，不是音源原始链接。代理会带上对应平台的 Referer/User-Agent，并转发 Range 请求，所以拖动进度条可用，也避免了防盗链和混合内容问题。
- 签名 Token 有效期为 1 小时，只由本站生成，不能用来代理任意 URL。
- 同一首歌的解析结果缓存 3 分钟；关闭播放器或刷新页面会停止播放。
- 试听接口有独立限流（解析 30 次/分钟、拉流 300 次/分钟）。

## 洛雪（LX Music）兼容 API

### 方式一：生成自定义源脚本（推荐）

1. 登录后台 → “API 接入” → 新建 Token。
2. 复制生成的自定义源脚本 URL：
   `http://你的NAS内网IP:3000/api/lx/source.js?token=md_xxx`
3. 在洛雪音乐“设置 → 自定义源 → 在线导入”中粘贴该 URL，或把返回内容保存为 `.js` 后本地导入。
4. 启用该自定义源即可播放。

生成的脚本只包含本站地址和 Token，不包含任何音源密钥。支持的动作只有 `musicUrl`；歌词/封面暂未实现。

### 方式二：直接调用 HTTP API

所有请求需要 `X-API-Key: md_xxx` 请求头，或 `?token=md_xxx`。

解析播放链接：

```bash
curl -X POST http://你的NAS内网IP:3000/api/lx/resolve \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: md_xxx' \
  -d '{
    "source": "kw",
    "quality": "flac",
    "musicInfo": {
      "songmid": "435079395",
      "name": "孤勇者",
      "singer": "陈奕迅"
    }
  }'
```

参数：

- `source`：`kw` / `kg` / `tx` / `wy` / `mg`
- `quality`：`128k` / `192k` / `320k` / `flac` / `flac24bit` / `hires` / `atmos` / `atmos_plus` / `master` 等
- `musicInfo`：对应平台搜索结果的 `musicInfo` 原样传入
- `channel`：可选，`auto`（默认）、渠道名或渠道 ID

返回：

```json
{
  "code": 0,
  "data": {
    "url": "https://...",
    "channel": { "id": "...", "name": "某音源" },
    "requestedQuality": "flac",
    "elapsedMs": 420
  }
}
```

其他端点：

- `GET /api/lx/manifest?token=md_xxx`：查看当前启用渠道、平台和音质。
- `GET /api/lx/source.js?token=md_xxx`：获取生成的洛雪自定义源脚本。

每个 Token 默认限流 60 次/分钟。Token 在数据库只保存 SHA-256 摘要，创建后只显示一次，请立即保存。

## 后台

- **仪表盘**：任务统计、成功率、渠道健康度、下载目录。
- **音源管理**：上传 `.js`（≤2MB）、启用/禁用、上移/下移、测试初始化、删除；显示支持平台/音质/日志/最近错误。
- **设置**：音质策略（最高可用 / 严格最高 / FLAC 优先）、并发数、命名模板、文件大小上限、错歌校验、AI 选版（OpenAI 兼容接口）。
- **API 接入**：创建/禁用/删除 Token。

管理员只有一个，用户名/密码来自 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（默认用户名 `admin`），会话 Cookie 使用 `AUTH_SECRET` 签名，有效期 7 天。容器启动时会校验这两个变量：密码不能为空，`AUTH_SECRET` 至少 32 个字符；仍使用默认密码时会在日志中警告。登录接口有 15 分钟 8 次失败限流。

## 目录与数据

```
music-downloader/
├── app/                 Next.js 页面与 API
├── components/          前端组件
├── lib/                 搜索、音源运行时、下载、洛雪 API
├── worker/              音源沙箱 worker
├── prisma/              schema 与迁移
├── data/                SQLite、上传的音源、临时文件（Docker volume）
├── downloads/           本地开发时的默认下载目录
├── .github/             GitHub Actions 镜像构建
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

容器内：

- `/downloads`：宿主机音乐下载目录（默认 `/vol1/1000/音乐/downloads`）
- `/app/data/app.db`：SQLite
- `/app/data/sources/`：上传/导入的音源脚本
- `/app/data/tmp/`：下载临时文件

备份只需要备份宿主机 `./data` 和音乐目录。

## 常见问题

**下载失败，提示“所有渠道均失败”**

免费音源接口会失效或限流。先到后台“音源管理”逐个点“测试”，查看日志；再检查渠道是否处于冷却。可禁用失效音源，或上传新的洛雪音源脚本。

**实际音质比请求低**

不同渠道对同一首歌的可用音质不同。例如请求 FLAC，但所有渠道实际只返回 128k 时，任务会以 128k 完成并标记“已降级”，不会写入虚假的 FLAC 标签。可换平台或稍后重试。

**文件没有出现在 `/vol1/1000/音乐/downloads`**

检查 compose 的 volumes 路径、`PUID/PGID` 和目录权限。容器内 `DOWNLOAD_DIR=/downloads`，实际落盘路径会显示在下载详情里。

**洛雪导入后不能播放**

确认 `PUBLIC_BASE_URL` 是手机/电脑能访问的 NAS 内网地址，而不是 `localhost`；确认 Token 未禁用；先用 `curl` 调 `/api/lx/resolve` 验证。

**容器启动报数据库表不存在**

入口脚本会自动执行迁移。如果手动设置了 `SKIP_MIGRATIONS=1`，请改回 `0` 后重启。

**x86_64 / arm64**

`docker-compose.yml` 默认 `platform: linux/amd64`，适配飞牛 NAS。Apple Silicon 本地调试可改成 `linux/arm64` 或删除该行。Prisma 客户端在构建镜像内生成，需与运行架构一致。

## 安全与使用范围

- 建议只在局域网使用。需要公网访问时，请在前面加 HTTPS 反向代理，并使用强密码。
- 音源脚本仅允许管理员上传；worker 沙箱禁用了 `require` / `fs` / `process`，但 `vm` 不是硬安全边界，不要上传不可信脚本。
- 容器不挂载 Docker socket，使用非 root 运行，仅暴露 3000 端口。
- 本项目只提供搜索/下载工具，不存储音乐内容。请仅下载你有权访问和使用的内容，遵守当地版权法规及音乐平台服务条款。

## 本地开发

```bash
npm install
cp .env.example .env
# 本地开发把 DOWNLOAD_DIR 改成 ./downloads，DATABASE_URL 改成 file:../data/app.db
npx prisma migrate deploy
npm run dev
```

打开 `http://127.0.0.1:3000`。生产构建：

```bash
npm run build
npm start
```

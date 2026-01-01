# FFXIV Strategy Board Viewer & Editor

最终幻想14 (FFXIV) 战术板查看器与编辑器，支持解析和编辑游戏内战术板分享字符串。

## 项目结构

```
├── board.html              # 前端战术板编辑器 (单文件HTML应用)
├── cf-worker/
│   ├── worker.js           # Cloudflare Worker 后端服务
│   ├── wrangler.toml       # Wrangler 配置文件
│   └── package.json        # 依赖配置
└── assets/
    ├── background/         # 7张战斗场景背景图 (1-7.webp)
    └── objects/            # 100+ 战术标记图标 (webp格式)

```

## 功能特性

### 前端编辑器 (board.html)

- **导入分享码**: 解析游戏内战术板分享字符串 `[stgy:...]`
- **导出分享码**: 将编辑后的战术板导出为游戏可用的分享字符串
- **可视化编辑**:
  - 拖拽添加/移动对象
  - 缩放、旋转对象
  - 调整颜色和透明度
  - 水平/垂直翻转
  - 图层顺序调整
- **支持的对象类型**:
  - 职业标记 (坦克、治疗、DPS)
  - AOE 范围指示器 (圆形、扇形、矩形、圆环)
  - 自定义文本
  - 画线工具
  - 各类游戏内标记图标
- **7种战斗场景背景**
- **移动端适配**: 响应式设计，支持触屏操作

### 后端服务 (cf-worker/worker.js)

基于 Cloudflare Worker 的无服务器 API，提供分享字符串的编解码服务。

#### API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api` | GET | 健康检查 |
| `/api/decode` | POST | 解码分享字符串 |
| `/api/encode` | POST | 编码战术板数据 |

#### 解码请求示例

```bash
curl -X POST https://your-worker.workers.dev/api/decode \
  -H "Content-Type: application/json" \
  -d '{"share_string": "[stgy:aXXXXXXX...]"}'
```

响应:
```json
{
  "board_name": "战术板名称",
  "background": 1,
  "objects": [
    {
      "id": 9,
      "x": 512,
      "y": 384,
      "scale": 100,
      "angle": 0,
      "red": 255,
      "green": 144,
      "blue": 0,
      "alpha": 0.75,
      "param1": 0,
      "param2": 0,
      "param3": 0,
      "visible": true,
      "flip_horizontal": false,
      "flip_vertical": false,
      "locked": false,
      "string": ""
    }
  ]
}
```

#### 编码请求示例

```bash
curl -X POST https://your-worker.workers.dev/api/encode \
  -H "Content-Type: application/json" \
  -d '{
    "board_name": "我的战术板",
    "background": 1,
    "objects": [...]
  }'
```

响应:
```json
{
  "share_string": "[stgy:aXXXXXXX...]"
}
```

## 部署

### 前端部署

`board.html` 是一个单文件 HTML 应用，可直接部署到任何静态托管服务:

1. 直接用浏览器打开本地文件
2. 部署到 GitHub Pages / Vercel / Netlify
3. 部署到任意 Web 服务器

需要配置 `STATIC_BASE` 指向静态资源 CDN:
```javascript
const STATIC_BASE = 'https://your-cdn.com/assets';
```

### 后端部署 (Cloudflare Worker)

1. 安装依赖:
```bash
cd cf-worker
npm install
```

2. 本地开发:
```bash
npx wrangler dev
```

3. 部署到 Cloudflare:
```bash
npx wrangler deploy
```

## 技术实现

### 分享字符串格式

游戏内战术板分享字符串格式: `[stgy:aXXXXXX...]`

解码流程:
1. 提取 `[stgy:a` 和 `]` 之间的内容
2. XOR 解码 (使用字符映射表 + 种子值)
3. Base64 解码 (URL-safe 变体)
4. CRC32 校验
5. zlib 解压缩
6. 解析二进制数据结构

### 二进制数据结构

| Section | ID | 描述 |
|---------|----|----|
| Header | - | 24字节固定头部 |
| Section 1 | 1 | 战术板名称 (UTF-8, 4字节对齐) |
| Objects | 2 | 对象列表 |
| Section 4 | 4 | 对象标志 (可见/翻转/锁定) |
| Section 5 | 5 | 坐标数据 |
| Section 6 | 6 | 角度数据 |
| Section 7 | 7 | 缩放数据 |
| Section 8 | 8 | 颜色数据 (RGBA) |
| Section 10 | 10 | param1 数据 |
| Section 11 | 11 | param2 数据 |
| Section 12 | 12 | param3 数据 |
| Footer | 3 | 背景ID |

### 特殊对象类型

| ID | 类型 | param1 | param2 | param3 |
|----|------|--------|--------|--------|
| 9 | 圆形AOE | - | - | - |
| 10 | 扇形AOE | 角度(度) | - | - |
| 11 | 矩形AOE | 宽度 | 高度 | - |
| 12 | 画线 | 终点X | 终点Y | 线宽 |
| 17 | 圆环AOE | 角度(度) | 内半径 | - |
| 100 | 文本 | - | - | - |

## 依赖

### 前端
- 无外部依赖，纯原生 JavaScript

### 后端
- [pako](https://github.com/nodeca/pako) - zlib 压缩/解压缩库

## 许可证

MIT License

## 致谢

- 参考实现: [ffxiv-strategy-board-viewer](https://github.com/Ennea/ffxiv-strategy-board-viewer-master)
- 游戏资源版权归 Square Enix 所有

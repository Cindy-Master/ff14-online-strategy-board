/**
 * FFXIV Strategy Board Encoder/Decoder - Cloudflare Worker
 * 将战术板分享字符串编解码移植到边缘计算
 */

import pako from 'pako';

// ==================== 字符映射表 ====================
const FORWARD_TRANSLATION_TABLE = {
  '+': 'N', '-': 'P', '0': 'x', '1': 'g', '2': '0', '3': 'K', '4': '8', '5': 'S',
  '6': 'J', '7': '2', '8': 's', '9': 'Z', 'A': 'D', 'B': 'F', 'C': 't', 'D': 'T',
  'E': '6', 'F': 'E', 'G': 'a', 'H': 'V', 'I': 'c', 'J': 'p', 'K': 'L', 'L': 'M',
  'M': 'm', 'N': 'e', 'O': 'j', 'P': '9', 'Q': 'X', 'R': 'B', 'S': '4', 'T': 'R',
  'U': 'Y', 'V': '7', 'W': '_', 'X': 'n', 'Y': 'O', 'Z': 'b', 'a': 'i', 'b': '-',
  'c': 'v', 'd': 'H', 'e': 'C', 'f': 'A', 'g': 'r', 'h': 'W', 'i': 'o', 'j': 'd',
  'k': 'I', 'l': 'q', 'm': 'h', 'n': 'U', 'o': 'l', 'p': 'k', 'q': '3', 'r': 'f',
  's': 'y', 't': '5', 'u': 'G', 'v': 'w', 'w': '1', 'x': 'u', 'y': 'z', 'z': 'Q'
};

// 反向映射表
const REVERSE_TRANSLATION_TABLE = {};
for (const [k, v] of Object.entries(FORWARD_TRANSLATION_TABLE)) {
  REVERSE_TRANSLATION_TABLE[v] = k;
}

// Base64 字符集 (URL-safe，与 Python 一致)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function forwardTranslate(text) {
  return text.split('').map(c => FORWARD_TRANSLATION_TABLE[c] || c).join('');
}

function reverseTranslate(text) {
  return text.split('').map(c => REVERSE_TRANSLATION_TABLE[c] || c).join('');
}

function mapIn(c) {
  const idx = BASE64_CHARS.indexOf(c);
  return idx >= 0 ? idx : 0;
}

function mapOut(x) {
  return BASE64_CHARS[x & 0x3f];
}

function toBase64(text) {
  return text.replace(/-/g, '+').replace(/_/g, '/');
}

function fromBase64(text) {
  return text.replace(/\+/g, '-').replace(/\//g, '_');
}

// ==================== CRC32 ====================
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ==================== zlib 压缩/解压 (使用 pako) ====================
function zlibDecompress(data) {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  return pako.inflate(input);
}

function zlibCompress(data) {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  return pako.deflate(input);
}

// ==================== Base64 编解码 ====================
const BASE64_DECODE_MAP = {};
const STANDARD_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < 64; i++) {
  BASE64_DECODE_MAP[STANDARD_BASE64[i]] = i;
}

function base64Decode(str) {
  // 移除 padding
  str = str.replace(/=+$/, '');
  const len = str.length;
  const outputLen = Math.floor(len * 3 / 4);
  const bytes = new Uint8Array(outputLen);

  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const a = BASE64_DECODE_MAP[str[i]] || 0;
    const b = BASE64_DECODE_MAP[str[i + 1]] || 0;
    const c = BASE64_DECODE_MAP[str[i + 2]] || 0;
    const d = BASE64_DECODE_MAP[str[i + 3]] || 0;

    bytes[j++] = (a << 2) | (b >> 4);
    if (i + 2 < len) bytes[j++] = ((b & 0x0f) << 4) | (c >> 2);
    if (i + 3 < len) bytes[j++] = ((c & 0x03) << 6) | d;
  }

  return bytes.slice(0, j);
}

function base64Encode(bytes) {
  let binaryStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryStr += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryStr);
}

// ==================== 解码器 ====================
function decodeShareString(shareString) {
  // 验证格式
  if (!shareString.startsWith('[stgy:a') || !shareString.endsWith(']')) {
    throw new Error('无效的分享字符串格式');
  }

  const buffer = shareString.slice(7, -1);
  if (buffer.length < 2) {
    throw new Error('分享字符串太短');
  }

  // XOR 解码
  const seed = mapIn(forwardTranslate(buffer[0]));
  let decoded = '';
  for (let i = 0; i < buffer.length - 1; i++) {
    const c = buffer[i + 1];
    const t = forwardTranslate(c);
    const x = mapIn(t);
    const y = (x - seed - i) & 0x3f;
    decoded += mapOut(y);
  }

  // Base64 解码
  let base64Str = toBase64(decoded);
  const missingPadding = base64Str.length % 4;
  if (missingPadding) {
    base64Str += '='.repeat(4 - missingPadding);
  }

  const withHeader = base64Decode(base64Str);

  // 解析头部
  const view = new DataView(withHeader.buffer);
  const val1 = view.getUint16(0, true);
  const val2 = view.getUint16(2, true);
  const length = view.getUint16(4, true);

  // 验证 CRC32
  const crcData = withHeader.slice(4);
  const expectedCrc = ((val2 << 16) | val1) >>> 0;
  const actualCrc = crc32(crcData);
  if (expectedCrc !== actualCrc) {
    throw new Error(`CRC32 校验失败`);
  }

  // zlib 解压
  const compressed = withHeader.slice(6);
  const decompressed = zlibDecompress(compressed);

  // 解析二进制数据
  return parseStrategyBoardData(decompressed);
}

function parseStrategyBoardData(data) {
  const view = new DataView(data.buffer);
  let pos = 0;

  // 头部 (24字节)
  pos = 24;

  // Section 1: 板名
  const section1Id = view.getUint16(pos, true); pos += 2;
  const nameLen = view.getUint16(pos, true); pos += 2;
  const nameBytes = data.slice(pos, pos + nameLen - 1);
  const boardName = new TextDecoder('utf-8').decode(nameBytes);
  pos += nameLen;

  // 对象列表
  const objects = [];
  while (pos + 4 <= data.length) {
    const magic = view.getUint16(pos, true);
    if (magic !== 2) break;
    pos += 2;

    const objId = view.getUint16(pos, true);
    pos += 2;

    const obj = {
      id: objId,
      x: 0, y: 0,
      scale: 100,
      angle: 0,
      red: 255, green: 255, blue: 255,
      alpha: 1.0,
      param1: 0, param2: 0, param3: 0,
      visible: true,
      flip_horizontal: false,
      flip_vertical: false,
      locked: false,
      string: ''
    };

    if (objId === 100) {
      pos += 2; // unk
      const strLen = view.getUint16(pos, true); pos += 2;
      const strBytes = data.slice(pos, pos + strLen - 1);
      obj.string = new TextDecoder('utf-8').decode(strBytes);
      pos += strLen;
    }

    objects.push(obj);
  }

  const objCount = objects.length;

  // Section 4: 标志
  if (view.getUint16(pos, true) === 4) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      const flags = view.getUint16(pos, true); pos += 2;
      objects[i].visible = !(flags & 0x0100);
      objects[i].flip_horizontal = !!(flags & 0x0200);
      objects[i].flip_vertical = !!(flags & 0x0400);
      objects[i].locked = !!(flags & 0x0800);
    }
  }

  // Section 5: 坐标
  if (view.getUint16(pos, true) === 5) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      const x = view.getUint16(pos, true); pos += 2;
      const y = view.getUint16(pos, true); pos += 2;
      objects[i].x = Math.round(x / 5120 * 1024);
      objects[i].y = Math.round(y / 3840 * 768);
    }
  }

  // Section 6: 角度
  if (view.getUint16(pos, true) === 6) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      const angle = view.getInt16(pos, true); pos += 2;
      objects[i].angle = angle / 180 * Math.PI;
    }
  }

  // Section 7: 缩放
  if (view.getUint16(pos, true) === 7) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      objects[i].scale = data[pos]; pos += 1;
    }
    if (objCount % 2 === 1) pos += 1;
  }

  // Section 8: 颜色
  if (view.getUint16(pos, true) === 8) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      objects[i].red = data[pos]; pos += 1;
      objects[i].green = data[pos]; pos += 1;
      objects[i].blue = data[pos]; pos += 1;
      const t = data[pos]; pos += 1;
      objects[i].alpha = 1 - t / 100;
    }
  }

  // Section 10: param1
  if (view.getUint16(pos, true) === 10) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      objects[i].param1 = view.getUint16(pos, true); pos += 2;
    }
  }

  // Section 11: param2
  if (view.getUint16(pos, true) === 11) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      objects[i].param2 = view.getUint16(pos, true); pos += 2;
    }
  }

  // Section 12: param3
  if (view.getUint16(pos, true) === 12) {
    pos += 6;
    for (let i = 0; i < objCount; i++) {
      objects[i].param3 = view.getUint16(pos, true); pos += 2;
    }
  }

  // Footer
  let background = 1;
  if (view.getUint16(pos, true) === 3) {
    pos += 6;
    background = view.getUint16(pos, true);
  }

  // 反转对象顺序
  objects.reverse();

  return { board_name: boardName, background, objects };
}

// ==================== 编码器 ====================
function encodeShareString(board) {
  // 构建二进制数据
  const binaryData = buildStrategyBoardData(board);

  // zlib 压缩
  const compressed = zlibCompress(binaryData);

  // 构建头部
  const length = binaryData.length;
  const lengthBytes = new Uint8Array(2);
  lengthBytes[0] = length & 0xFF;
  lengthBytes[1] = (length >> 8) & 0xFF;

  // 计算 CRC32
  const crcData = new Uint8Array(lengthBytes.length + compressed.length);
  crcData.set(lengthBytes, 0);
  crcData.set(compressed, 2);
  const crc32Value = crc32(crcData);

  const val1 = crc32Value & 0xFFFF;
  const val2 = (crc32Value >> 16) & 0xFFFF;

  // 构建完整数据
  const withHeader = new Uint8Array(6 + compressed.length);
  withHeader[0] = val1 & 0xFF;
  withHeader[1] = (val1 >> 8) & 0xFF;
  withHeader[2] = val2 & 0xFF;
  withHeader[3] = (val2 >> 8) & 0xFF;
  withHeader[4] = length & 0xFF;
  withHeader[5] = (length >> 8) & 0xFF;
  withHeader.set(compressed, 6);

  // Base64 编码
  const base64Str = base64Encode(withHeader);
  const urlSafe = fromBase64(base64Str).replace(/=+$/, '');

  // XOR 编码
  const seed = Math.floor(Math.random() * 64);
  let encoded = reverseTranslate(mapOut(seed));

  for (let i = 0; i < urlSafe.length; i++) {
    const y = mapIn(urlSafe[i]);
    const x = (y + seed + i) & 0x3f;
    encoded += reverseTranslate(mapOut(x));
  }

  return `[stgy:a${encoded}]`;
}

function buildStrategyBoardData(board) {
  const objects = [...board.objects].reverse();
  const objCount = objects.length;

  // 估算大小并创建缓冲区
  const buffer = new ArrayBuffer(1024 + objCount * 50);
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);
  let pos = 0;

  // 头部 (24字节)
  view.setUint32(pos, 2, true); pos += 4;  // header_magic
  const length1Pos = pos; pos += 2;        // length1 占位
  pos += 12;                                // unk
  const length2Pos = pos; pos += 2;        // length2 占位
  pos += 4;                                 // unk

  // Section 1: 板名
  view.setUint16(pos, 1, true); pos += 2;
  const nameBytes = new TextEncoder().encode(board.board_name + '\0');
  view.setUint16(pos, nameBytes.length, true); pos += 2;
  data.set(nameBytes, pos); pos += nameBytes.length;

  // 对象列表
  for (const obj of objects) {
    view.setUint16(pos, 2, true); pos += 2;
    view.setUint16(pos, obj.id, true); pos += 2;

    if (obj.id === 100 && obj.string) {
      view.setUint16(pos, 0, true); pos += 2;
      const strBytes = new TextEncoder().encode(obj.string + '\0');
      view.setUint16(pos, strBytes.length, true); pos += 2;
      data.set(strBytes, pos); pos += strBytes.length;
    }
  }

  // Section 4: 标志
  view.setUint16(pos, 4, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    let flags = 0x0001;
    if (!obj.visible) flags |= 0x0100;
    if (obj.flip_horizontal) flags |= 0x0200;
    if (obj.flip_vertical) flags |= 0x0400;
    if (obj.locked) flags |= 0x0800;
    view.setUint16(pos, flags, true); pos += 2;
  }

  // Section 5: 坐标
  view.setUint16(pos, 5, true); pos += 2;
  view.setUint16(pos, 3, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    const x = Math.round(obj.x / 1024 * 5120);
    const y = Math.round(obj.y / 768 * 3840);
    view.setUint16(pos, x, true); pos += 2;
    view.setUint16(pos, y, true); pos += 2;
  }

  // Section 6: 角度
  view.setUint16(pos, 6, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    const angle = Math.round(obj.angle / Math.PI * 180);
    view.setInt16(pos, angle, true); pos += 2;
  }

  // Section 7: 缩放
  view.setUint16(pos, 7, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    data[pos] = obj.scale; pos += 1;
  }
  if (objCount % 2 === 1) pos += 1;

  // Section 8: 颜色
  view.setUint16(pos, 8, true); pos += 2;
  view.setUint16(pos, 2, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    data[pos] = obj.red; pos += 1;
    data[pos] = obj.green; pos += 1;
    data[pos] = obj.blue; pos += 1;
    data[pos] = Math.round((1 - obj.alpha) * 100); pos += 1;
  }

  // Section 10: param1
  view.setUint16(pos, 10, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    view.setUint16(pos, obj.param1 || 0, true); pos += 2;
  }

  // Section 11: param2
  view.setUint16(pos, 11, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    view.setUint16(pos, obj.param2 || 0, true); pos += 2;
  }

  // Section 12: param3
  view.setUint16(pos, 12, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, objCount, true); pos += 2;
  for (const obj of objects) {
    view.setUint16(pos, obj.param3 || 0, true); pos += 2;
  }

  // Footer
  view.setUint16(pos, 3, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, board.background || 1, true); pos += 2;

  // 填充 length1 和 length2
  const totalLen = pos;
  view.setUint16(length1Pos, totalLen - 16, true);
  view.setUint16(length2Pos, totalLen - 28, true);

  return data.slice(0, pos);
}

// ==================== Worker 入口 ====================
export default {
  async fetch(request, env, ctx) {
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // GET / - 健康检查
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'FFXIV Strategy Board Encoder/Decoder',
          endpoints: ['/decode', '/encode']
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /decode - 解码分享字符串
      if (url.pathname === '/decode' && request.method === 'POST') {
        const body = await request.json();
        const shareString = body.share_string;

        if (!shareString) {
          return new Response(JSON.stringify({ error: '缺少 share_string 参数' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const result = decodeShareString(shareString);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /encode - 编码战术板数据
      if (url.pathname === '/encode' && request.method === 'POST') {
        const body = await request.json();

        if (!body.board_name || !body.objects) {
          return new Response(JSON.stringify({ error: '缺少必要参数' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const shareString = encodeShareString(body);
        return new Response(JSON.stringify({ share_string: shareString }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

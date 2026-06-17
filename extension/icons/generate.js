// MeetNotes 아이콘 생성 — 순수 Node.js (외부 패키지 없음)
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (~crc) >>> 0
}

function chunk(type, data) {
  const t   = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crcBuf])
}

function makePNG(size) {
  const cx = size / 2, cy = size / 2
  const outerR = size * 0.42   // 바깥 원
  const innerR = size * 0.22   // 안쪽 구멍

  // RGB 픽셀 데이터
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy
      const d  = Math.sqrt(dx * dx + dy * dy)
      const off = y * (size * 3 + 1) + 1 + x * 3

      if (d <= outerR && d > innerR) {
        // 녹색 링: #1ed760
        raw[off] = 0x1e; raw[off + 1] = 0xd7; raw[off + 2] = 0x60
      } else if (d <= innerR) {
        // 중앙 진한 녹색: #0d2a0d
        raw[off] = 0x0d; raw[off + 1] = 0x2a; raw[off + 2] = 0x0d
      } else {
        // 배경: #121212
        raw[off] = 0x12; raw[off + 1] = 0x12; raw[off + 2] = 0x12
      }
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG 시그니처
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 48, 128]) {
  const file = path.join(__dirname, `icon${size}.png`)
  fs.writeFileSync(file, makePNG(size))
  console.log(`✓ icon${size}.png`)
}

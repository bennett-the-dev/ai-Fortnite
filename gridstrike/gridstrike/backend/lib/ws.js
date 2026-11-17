// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation) with no dependencies.
// Written so the whole stack is testable without npm. You may swap in the `ws` package later; the Room code only needs conn.send / 'message' / 'close'.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function attachWs(server, { path = '/ws', onConnection, maxPayload = 64 * 1024, verifyClient = () => true }) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (new URL(req.url, 'http://x').pathname !== path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !verifyClient(req)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    onConnection(new WsConn(socket, maxPayload), req);
  });
}

export function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class WsConn extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket; this.max = maxPayload; this.buf = Buffer.alloc(0);
    this.frags = []; this.fragOp = 0; this.open = true;
    socket.on('data', (d) => { try { this._data(d); } catch (e) { this.close(1002); } });
    socket.on('close', () => { this.open = false; this.emit('close'); });
    socket.on('error', () => socket.destroy());
  }

  send(str) { if (this.open) this.socket.write(encodeFrame(1, Buffer.from(String(str)))); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.socket.write(encodeFrame(8, p));
    this.open = false;
    this.socket.end();
  }

  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (!masked) return this.close(1002);                 // clients must mask
      if (b0 & 0x70) return this.close(1002);               // no extensions negotiated
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(this.max)) return this.close(1009); len = Number(big); off = 10; }
      if (len > this.max) return this.close(1009);
      if (op >= 8 && (len > 125 || !fin)) return this.close(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._frame(fin, op, data);
    }
  }

  _frame(fin, op, data) {
    if (op === 8) return this.close(1000);
    if (op === 9) { this.socket.write(encodeFrame(10, data)); return; }
    if (op === 10) return;
    if (op === 1 || op === 2) { if (this.frags.length) return this.close(1002); this.fragOp = op; this.frags = [data]; }
    else if (op === 0) { if (!this.frags.length) return this.close(1002); this.frags.push(data); }
    else return this.close(1002);
    if (this.frags.reduce((s, b) => s + b.length, 0) > this.max) return this.close(1009);
    if (fin) {
      const msg = Buffer.concat(this.frags); this.frags = [];
      if (this.fragOp === 1) this.emit('message', msg.toString('utf8'));
    }
  }
}

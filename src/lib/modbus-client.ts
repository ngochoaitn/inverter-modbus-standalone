import { createConnection, Socket } from 'net';

const TIMEOUT_MS = 8000;

function crc16(buf: Buffer, offset: number, len: number): number {
  let crc = 0xFFFF;
  for (let i = 0; i < len; i++) {
    crc ^= buf[offset + i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return crc;
}

function serial10(s: string): Buffer {
  return Buffer.from(s.padEnd(10, ' ').slice(0, 10), 'ascii');
}

function buildReadPacket(
  dongleSn: string, deviceSn: string,
  startReg: number, count: number, fc: number,
): Buffer {
  const buf = Buffer.alloc(38);
  buf[0] = 0xA1; buf[1] = 0x1A;
  buf.writeUInt16LE(2, 2);
  buf.writeUInt16LE(32, 4);
  buf[6] = 0x01;
  buf[7] = 194;
  serial10(dongleSn).copy(buf, 8);
  buf.writeUInt16LE(18, 18);
  buf[20] = 0x00;
  buf[21] = fc;
  serial10(deviceSn).copy(buf, 22);
  buf.writeUInt16LE(startReg, 32);
  buf.writeUInt16LE(count, 34);
  buf.writeUInt16LE(crc16(buf, 20, 16), 36);
  return buf;
}

/**
 * Try to parse one complete LuxPower packet.
 * Returns the register values if the packet matches expectedReg/expectedFc.
 * Returns null if it's a broadcast or response for a different register (caller should skip).
 * Throws on genuine protocol errors (bad CRC, Modbus error code, etc.).
 */
function tryParseFrame(packet: Buffer, expectedReg: number, expectedFc: number): number[] | null {
  if (packet.length < 6 || packet[0] !== 0xA1 || packet[1] !== 0x1A) {
    throw new Error('LuxPower invalid header');
  }

  const protocol = packet.readUInt16LE(2);
  const frameLength = packet.readUInt16LE(4);
  const packetLength = frameLength + 6;

  if (packet.length < packetLength) throw new Error('LuxPower packet truncated');
  if (packet[7] !== 194) throw new Error(`LuxPower bad control byte: ${packet[7]}`);

  const crcReceived = packet.readUInt16LE(packetLength - 2);
  const crcCalc = crc16(packet, 20, packetLength - 22);
  if (crcReceived !== crcCalc) throw new Error('LuxPower CRC mismatch');

  const frame = packet.subarray(20);
  const responseFc = frame[1];
  const responseReg = frame.readUInt16LE(12);

  if (responseFc & 0x80) {
    throw new Error(`LuxPower Modbus error code=${frame[2]} FC=${responseFc}`);
  }

  // Strict FC match: the inverter broadcasts FC=3 reg=0 on connect, which must be
  // distinguished from the actual FC=4 response to our request. Returning null tells
  // the caller to skip this frame and keep waiting.
  if (responseFc !== expectedFc || responseReg !== expectedReg) {
    return null; // Broadcast or response for a different register — skip
  }

  // Use the REQUEST fc for hasLengthByte, matching ESP32 firmware logic
  const hasLengthByte = (protocol === 2 || protocol === 5) && (expectedFc !== 6 && expectedFc < 0x80);
  const valueOffset = hasLengthByte ? 15 : 14;
  const byteCount = hasLengthByte ? frame[14] : (packetLength - 22 - 14);

  if (byteCount <= 0 || byteCount % 2 !== 0) {
    throw new Error(`LuxPower invalid byte count: ${byteCount}`);
  }

  const values: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    values.push(frame.readUInt16LE(valueOffset + i));
  }
  return values;
}

/**
 * Persistent TCP session to one LuxPower inverter.
 *
 * Mirrors the ESP32's luxPollClient approach: open ONE connection per poll cycle
 * and send all register-block requests sequentially on the same socket.
 * This avoids the broadcast-to-all-clients confusion that occurs when each block
 * opens its own TCP connection.
 */
export class LuxSession {
  private buf = Buffer.alloc(0);
  private resolve: ((v: number[]) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;
  private pendingReg = -1;
  private pendingFc = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('LuxPower connection closed')));
  }

  static connect(host: string, port: number): Promise<LuxSession> {
    return new Promise((resolve, reject) => {
      const s = createConnection({ host, port });
      s.setTimeout(TIMEOUT_MS);
      s.once('connect', () => resolve(new LuxSession(s)));
      s.once('timeout', () => { s.destroy(); reject(new Error(`LuxPower connect timeout ${host}:${port}`)); });
      s.once('error', reject);
    });
  }

  readRegisters(
    dongleSn: string, deviceSn: string,
    fc: number, startAddr: number, count: number,
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.pendingReg = startAddr;
      this.pendingFc = fc;
      this.timer = setTimeout(() => {
        const r = this.reject;
        this.resolve = null;
        this.reject = null;
        this.pendingReg = -1;
        this.pendingFc = -1;
        if (r) r(new Error(`LuxPower timeout FC=${fc} reg=${startAddr}`));
      }, TIMEOUT_MS);
      this.socket.write(buildReadPacket(dongleSn, deviceSn, startAddr, count, fc));
      this.drain(); // process any already-buffered data
    });
  }

  readInputRegisters(dongleSn: string, deviceSn: string, start: number, count: number) {
    return this.readRegisters(dongleSn, deviceSn, 4, start, count);
  }

  readHoldingRegisters(dongleSn: string, deviceSn: string, start: number, count: number) {
    return this.readRegisters(dongleSn, deviceSn, 3, start, count);
  }

  close() {
    this.clearTimer();
    this.socket.destroy();
  }

  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private fail(err: Error) {
    this.clearTimer();
    const r = this.reject;
    this.resolve = null;
    this.reject = null;
    this.pendingReg = -1;
    this.pendingFc = -1;
    if (r) r(err);
  }

  private drain() {
    while (true) {
      if (this.buf.length < 6) return;

      // Locate the 0xA1 0x1A magic header
      let hi = -1;
      for (let i = 0; i <= this.buf.length - 2; i++) {
        if (this.buf[i] === 0xA1 && this.buf[i + 1] === 0x1A) { hi = i; break; }
      }
      if (hi < 0) { this.buf = Buffer.alloc(0); return; }
      if (hi > 0) this.buf = this.buf.subarray(hi);
      if (this.buf.length < 6) return;

      const frameLen = this.buf.readUInt16LE(4);
      const packetLen = frameLen + 6;
      if (this.buf.length < packetLen) return; // incomplete frame, wait for more data

      const rawFrame = this.buf.subarray(0, packetLen);
      this.buf = this.buf.subarray(packetLen);

      if (this.resolve === null || this.pendingReg < 0) continue; // no pending request, discard

      try {
        const result = tryParseFrame(rawFrame, this.pendingReg, this.pendingFc);
        if (result === null) {
          // Broadcast or response for a different register — skip silently
          const rFc = rawFrame.length > 21 ? rawFrame[21] : '?';
          const rReg = rawFrame.length > 33 ? rawFrame.readUInt16LE(32) : '?';
          console.warn(`[Modbus] Skipping broadcast: FC=${rFc} reg=${rReg} (waiting FC=${this.pendingFc} reg=${this.pendingReg})`);
          continue;
        }
        // Got the matching response
        this.clearTimer();
        const r = this.resolve;
        this.resolve = null;
        this.reject = null;
        this.pendingReg = -1;
        this.pendingFc = -1;
        r(result);
      } catch (err: any) {
        this.fail(err);
        return;
      }
    }
  }
}

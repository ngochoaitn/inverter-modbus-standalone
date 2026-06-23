import db from './db';
import { mapLuxpower } from './mapper';
import { LuxSession } from './modbus-client';
import { publish } from './push';

// Fast poll matches ESP32 luxPollClient pattern: 1 s, real-time registers only.
const POLL_INTERVAL_MS      = 1000;
// Slow poll (energy-today counters) every 30 s — they are daily cumulative values
// that change at most once per inverter reporting cycle; no need to read every second.
const SLOW_POLL_INTERVAL_MS = 30_000;
const HISTORY_INTERVAL_MS   = 60_000;

interface DeviceConfig {
  deviceSn: string;
  dongleSn: string;
  inverterIp: string;
  inverterPort: number;
}

function getConfig(): DeviceConfig | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('deviceConfig') as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

let lastHistorySave  = 0;
let lastSlowPoll     = 0;
// Merged register snapshot — fast-poll values overwrite each cycle;
// slow-poll values persist until the next slow poll.
let inputSnapshot: Record<string, number> = {};

async function pollFast(config: DeviceConfig) {
  const { deviceSn, dongleSn, inverterIp, inverterPort } = config;

  // One persistent TCP connection per poll cycle (mirrors ESP32 luxPollClient).
  const session = await LuxSession.connect(inverterIp, inverterPort);
  const fastInput: Record<string, number> = {};

  try {
    // Block 1: regs 0–27 — state, PV1-3 V/P, battery V/SOC/flow, grid V/Hz/flow
    const b1 = await session.readInputRegisters(dongleSn, deviceSn, 0, 28);
    for (let i = 0; i < b1.length; i++) fastInput[String(i)] = b1[i];

    // Block 2: regs 96–98 — battery parallel count, capacity (Ah), signed current.
    // reg 97 (I_BAT_CAPACITY) is what lets us estimate time-to-full; it changes
    // rarely but sits next to the current register so we grab all three at once.
    const b2 = await session.readInputRegisters(dongleSn, deviceSn, 96, 3);
    for (let i = 0; i < b2.length; i++) fastInput[String(96 + i)] = b2[i];

    // Block 3: regs 170–171 — load power, load energy today
    const b3 = await session.readInputRegisters(dongleSn, deviceSn, 170, 2);
    for (let i = 0; i < b3.length; i++) fastInput[String(170 + i)] = b3[i];

    // Block 3b: regs 64–67 — temperatures (internal, radiator 1/2, battery).
    // Wrapped so a temperature read failure never aborts the whole poll cycle.
    try {
      const bTemp = await session.readInputRegisters(dongleSn, deviceSn, 64, 4);
      for (let i = 0; i < bTemp.length; i++) fastInput[String(64 + i)] = bTemp[i];
    } catch (err: any) {
      console.warn('[Poller] temperature read failed (regs 64-67):', err?.message ?? err);
    }

    // Block 4: regs 217–220 — PV4-6 strings (optional on single/dual-string models)
    try {
      const b4 = await session.readInputRegisters(dongleSn, deviceSn, 217, 4);
      for (let i = 0; i < b4.length; i++) fastInput[String(217 + i)] = b4[i];
    } catch {
      // Not fatal — skip for inverters that don't have PV4-6
    }
  } finally {
    session.close();
  }

  // Merge fast-poll values into the persistent snapshot
  Object.assign(inputSnapshot, fastInput);

  const registers = { input: inputSnapshot };
  const mapped    = mapLuxpower(registers);
  const now       = new Date().toISOString();

  const latestJson = JSON.stringify({ deviceSn, dongleSn, lastSeenAt: now, metrics: mapped, registers });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`latest_${deviceSn}`, latestJson);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeDeviceSn', deviceSn);
  publish(latestJson);

  if (Date.now() - lastHistorySave >= HISTORY_INTERVAL_MS) {
    db.prepare('INSERT INTO history (deviceSn, createdAt, data) VALUES (?, ?, ?)').run(
      deviceSn, now, JSON.stringify(mapped),
    );
    lastHistorySave = Date.now();
  }

  const s = inputSnapshot;
  console.log(
    `[Poller] OK — ${deviceSn} SOC=${mapped.batterySoc}% PV=${mapped.pvPower}W load=${mapped.loadPower}W ` +
    `temp(in/rad/bat)=${mapped.internalTemperature ?? '--'}/${mapped.radiator1Temperature ?? '--'}/${mapped.batteryTemperature ?? '--'}°C ` +
    `[raw r64=${s['64']} r214=${s['214'] ?? '∅'} r66=${s['66']} r67=${s['67']} r103=${s['103'] ?? '∅'} r104=${s['104'] ?? '∅'}]` + 
    `[bat cap: batterySoh=${mapped.batterySoh}, batteryCapacityAh=${mapped.batteryCapacityAh}, batteryCycleCount=${mapped.batteryCycleCount}], batterySoc=${mapped.batterySoc}`,
  );
}

async function pollSlow(config: DeviceConfig) {
  const { deviceSn, dongleSn, inverterIp, inverterPort } = config;

  const session = await LuxSession.connect(inverterIp, inverterPort);
  try {
    // regs 28–37 — energy-today counters (PV/battery/grid kWh accumulators)
    const b = await session.readInputRegisters(dongleSn, deviceSn, 28, 10);
    for (let i = 0; i < b.length; i++) inputSnapshot[String(28 + i)] = b[i];

    // regs 101–106 — BMS max/min cell voltage & temperature, FW state, cycle count.
    // reg 103/104 give the real battery temperature on models that leave reg 67 at 0;
    // reg 106 (cycle count) is a coarse battery-ageing indicator.
    try {
      const bms = await session.readInputRegisters(dongleSn, deviceSn, 101, 6);
      for (let i = 0; i < bms.length; i++) inputSnapshot[String(101 + i)] = bms[i];
    } catch {
      // Non-fatal: no BMS / unsupported
    }

    // regs 214–216 — NTC temperatures (internal INDC, radiator DCDC L/H).
    // V23+ firmware only; used as the internal-temp fallback when reg 64 is 0.
    try {
      const ntc = await session.readInputRegisters(dongleSn, deviceSn, 214, 3);
      for (let i = 0; i < ntc.length; i++) inputSnapshot[String(214 + i)] = ntc[i];
    } catch {
      // Non-fatal: older firmware without NTC temperature registers
    }
  } finally {
    session.close();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __luxPollerTimer: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __luxPollerBusy: boolean;
}

export function startPoller() {
  if (global.__luxPollerTimer) return;

  global.__luxPollerBusy = false;

  const run = async () => {
    if (global.__luxPollerBusy) return;
    global.__luxPollerBusy = true;
    try {
      const config = getConfig();
      if (!config) return;

      // Slow poll first so energy-today values are fresh when fast poll publishes
      if (Date.now() - lastSlowPoll >= SLOW_POLL_INTERVAL_MS) {
        try {
          await pollSlow(config);
          lastSlowPoll = Date.now();
        } catch {
          // Non-fatal: energy-today will retain last known values
        }
      }

      await pollFast(config);
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (!msg.includes('ECONNREFUSED') && !msg.includes('ETIMEDOUT') && !msg.includes('timeout')) {
        console.error('[Poller]', msg);
      }
    } finally {
      global.__luxPollerBusy = false;
    }
  };

  run();
  global.__luxPollerTimer = setInterval(run, POLL_INTERVAL_MS);
  console.log('[lux-local] Modbus poller started (fast=%dms slow=%dms)', POLL_INTERVAL_MS, SLOW_POLL_INTERVAL_MS);
}

export function stopPoller() {
  if (global.__luxPollerTimer) {
    clearInterval(global.__luxPollerTimer);
    global.__luxPollerTimer = undefined;
  }
}

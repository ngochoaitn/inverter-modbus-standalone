
export type RegisterType = 'input' | 'hold';

export interface Registers {
  input?: Record<string, number>;
  hold?: Record<string, number>;
}

const stateText: Record<number, string> = {
  0: 'Standby', 1: 'Fault', 2: 'Updating', 4: 'Normal', 8: 'Normal', 12: 'Normal',
  16: 'Normal', 17: 'Standby', 20: 'Normal', 32: 'Grid Charging', 40: 'Grid Charging',
  64: 'Off-Grid', 96: 'Off-Grid', 128: 'Off-Grid', 136: 'Off-Grid', 192: 'Off-Grid',
};

function raw(registers: Registers, type: RegisterType, addr: number) {
  return registers[type]?.[String(addr)];
}

function signed16(v: number) {
  return v < 32768 ? v : v - 65536;
}

export function mapLuxpower(registers: Registers) {
  const r = registers;

  // Sum all available PV string powers (reg 7-9 = PV1-3, reg 220-222 = PV4-6)
  const getPVPower = () => {
    let total = 0;
    for (const addr of [7, 8, 9, 220, 221, 222]) {
      total += raw(r, 'input', addr) ?? 0;
    }
    return total;
  };

  // Positive = exporting to grid, negative = importing from grid
  const getGridFlow = () => {
    const toGrid   = raw(r, 'input', 26) ?? 0;
    const fromGrid = raw(r, 'input', 27) ?? 0;
    return toGrid - fromGrid;
  };

  // Positive = discharging, negative = charging
  const getBatteryFlow = () => {
    const charge    = raw(r, 'input', 10) ?? 0;
    const discharge = raw(r, 'input', 11) ?? 0;
    return discharge - charge;
  };

  const status = raw(r, 'input', 0) ?? 0;

  return {
    inverterState: stateText[status] ?? `Unknown (${status})`,

    // PV
    pvPower:    getPVPower(),
    pv1Power:   raw(r, 'input', 7),
    pv2Power:   raw(r, 'input', 8),
    pv3Power:   raw(r, 'input', 9),
    pv1Voltage: (raw(r, 'input', 1) ?? 0) * 0.1,
    pv2Voltage: (raw(r, 'input', 2) ?? 0) * 0.1,
    pv3Voltage: (raw(r, 'input', 3) ?? 0) * 0.1,

    // Battery — reg 5 packs SOC in low byte, SOH in high byte
    batteryVoltage:        (raw(r, 'input', 4) ?? 0) * 0.1,
    batterySoc:            (raw(r, 'input', 5) ?? 0) & 0xFF,
    batteryFlow:           getBatteryFlow(),
    batteryChargePower:    raw(r, 'input', 10),
    batteryDischargePower: raw(r, 'input', 11),

    // Grid
    gridVoltage:   (raw(r, 'input', 12) ?? 0) * 0.1,
    gridFrequency: (raw(r, 'input', 15) ?? 0) * 0.01,
    gridFlow:      getGridFlow(),
    powerToGrid:   raw(r, 'input', 26),
    powerFromGrid: raw(r, 'input', 27),

    // Load & EPS
    loadPower: raw(r, 'input', 170) ?? 0,
    epsPower:  raw(r, 'input', 24) ?? 0,

    // Energy today (all × 0.1 kWh)
    pvEnergyToday:               ((raw(r, 'input', 28) ?? 0) + (raw(r, 'input', 29) ?? 0) + (raw(r, 'input', 30) ?? 0)) * 0.1,
    importEnergyToday:           (raw(r, 'input', 37) ?? 0) * 0.1,
    exportEnergyToday:           (raw(r, 'input', 36) ?? 0) * 0.1,
    batteryChargeEnergyToday:    (raw(r, 'input', 33) ?? 0) * 0.1,
    batteryDischargeEnergyToday: (raw(r, 'input', 34) ?? 0) * 0.1,
    loadEnergyToday:             (raw(r, 'input', 171) ?? 0) * 0.1,

    // Home consumption: reg 171 if available, else energy-balance formula
    // (same logic as backend homeConsumptionEnergyToday)
    get homeConsumptionEnergyToday() {
      const r171 = raw(r, 'input', 171);
      if (r171 != null && r171 > 0) return r171 * 0.1;
      const pv  = (raw(r, 'input', 28) ?? 0) + (raw(r, 'input', 29) ?? 0) + (raw(r, 'input', 30) ?? 0);
      const imp = raw(r, 'input', 37) ?? 0;
      const exp = raw(r, 'input', 36) ?? 0;
      const chg = raw(r, 'input', 33) ?? 0;
      const dis = raw(r, 'input', 34) ?? 0;
      return Math.max(pv + imp + dis - exp - chg, 0) * 0.1;
    },
  };
}

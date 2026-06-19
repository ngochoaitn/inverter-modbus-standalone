// History metric catalogue — ported from the official SolarIOT historyMetrics.
// Used by HistoricalGraph's "Thêm chỉ số" (add metric) picker.

export interface MetricItem {
  key: string;
  label: string;
  unit: string;
}

export interface MetricGroup {
  group: string;
  items: MetricItem[];
}

export const METRIC_CATALOG: MetricGroup[] = [
  {
    group: 'Công suất',
    items: [
      { key: 'pvPower', label: 'Công suất PV', unit: 'W' },
      { key: 'loadPower', label: 'Tải tiêu thụ', unit: 'W' },
      { key: 'batteryFlow', label: 'Dòng pin (±)', unit: 'W' },
      { key: 'batteryChargePower', label: 'Công suất sạc', unit: 'W' },
      { key: 'batteryDischargePower', label: 'Công suất xả', unit: 'W' },
      { key: 'gridFlow', label: 'Lưới (±)', unit: 'W' },
      { key: 'powerToGrid', label: 'Bán lên lưới', unit: 'W' },
      { key: 'powerFromGrid', label: 'Mua từ lưới', unit: 'W' },
      { key: 'inverterPower', label: 'Công suất inverter', unit: 'W' },
      { key: 'epsPower', label: 'Công suất EPS', unit: 'W' },
      { key: 'consumptionPower', label: 'Tiêu thụ', unit: 'W' },
      { key: 'generatorPower', label: 'Máy phát', unit: 'W' },
      { key: 'pv1Power', label: 'PV1', unit: 'W' },
      { key: 'pv2Power', label: 'PV2', unit: 'W' },
      { key: 'pv3Power', label: 'PV3', unit: 'W' },
      { key: 'pv4Power', label: 'PV4', unit: 'W' },
    ],
  },
  {
    group: 'Pin',
    items: [
      { key: 'batterySoc', label: 'SOC pin', unit: '%' },
      { key: 'batterySoh', label: 'SOH pin', unit: '%' },
      { key: 'batteryVoltage', label: 'Điện áp pin', unit: 'V' },
      { key: 'batteryCurrent', label: 'Dòng điện pin', unit: 'A' },
      { key: 'batteryTemperature', label: 'Nhiệt độ pin', unit: '°C' },
      { key: 'bmsLimitCharge', label: 'BMS giới hạn sạc', unit: 'A' },
      { key: 'bmsLimitDischarge', label: 'BMS giới hạn xả', unit: 'A' },
    ],
  },
  {
    group: 'PV (điện áp)',
    items: [
      { key: 'pv1Voltage', label: 'PV1 điện áp', unit: 'V' },
      { key: 'pv2Voltage', label: 'PV2 điện áp', unit: 'V' },
      { key: 'pv3Voltage', label: 'PV3 điện áp', unit: 'V' },
      { key: 'pv4Voltage', label: 'PV4 điện áp', unit: 'V' },
    ],
  },
  {
    group: 'Lưới',
    items: [
      { key: 'gridVoltage', label: 'Điện áp lưới', unit: 'V' },
      { key: 'gridFrequency', label: 'Tần số lưới', unit: 'Hz' },
    ],
  },
  {
    group: 'Nhiệt độ',
    items: [
      { key: 'internalTemperature', label: 'Nhiệt độ trong', unit: '°C' },
      { key: 'radiator1Temperature', label: 'Tản nhiệt 1', unit: '°C' },
      { key: 'inverterTemperature', label: 'Nhiệt độ inverter', unit: '°C' },
      { key: 'dcAcTemperature', label: 'Nhiệt độ DC-AC', unit: '°C' },
      { key: 'dcDcTemperature', label: 'Nhiệt độ DC-DC', unit: '°C' },
    ],
  },
  {
    group: 'Năng lượng (hôm nay)',
    items: [
      { key: 'pvEnergyToday', label: 'PV hôm nay', unit: 'kWh' },
      { key: 'homeConsumptionEnergyToday', label: 'Tiêu thụ hôm nay', unit: 'kWh' },
      { key: 'batteryChargeEnergyToday', label: 'Pin nạp hôm nay', unit: 'kWh' },
      { key: 'batteryDischargeEnergyToday', label: 'Pin xả hôm nay', unit: 'kWh' },
      { key: 'importEnergyToday', label: 'Mua lưới hôm nay', unit: 'kWh' },
      { key: 'exportEnergyToday', label: 'Bán lưới hôm nay', unit: 'kWh' },
    ],
  },
];

export const METRIC_COLORS = [
  '#38a34b', '#d44728', '#c99318', '#5ba4d4', '#a855f7',
  '#0ea5e9', '#ec4899', '#14b8a6', '#f97316', '#64748b',
];

const METRIC_BY_KEY: Record<string, MetricItem> = Object.fromEntries(
  METRIC_CATALOG.flatMap(g => g.items).map(it => [it.key, it]),
);

export function resolveMetric(key: string): MetricItem {
  return METRIC_BY_KEY[key] || { key, label: key, unit: '' };
}

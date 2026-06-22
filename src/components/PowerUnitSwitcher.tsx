'use client';

import { usePowerUnit } from '@/lib/prefs/PowerUnitProvider';
import { useT } from '@/lib/i18n/I18nProvider';

// Cycles the power-unit preference Auto → W → kW. Compact in the mobile header
// (circle, short "TĐ"/"A" for auto) and a regular button on desktop.
export default function PowerUnitSwitcher({ variant = 'btn' }: { variant?: 'btn' | 'circle' }) {
  const { unit, cycle } = usePowerUnit();
  const t = useT();

  const label =
    unit !== 'auto' ? unit : variant === 'circle' ? t('powerUnit.autoShort') : t('powerUnit.auto');

  return (
    <button
      type="button"
      className={variant === 'circle' ? 'sfm-circle-btn' : 'sf-btn'}
      onClick={cycle}
      title={t('powerUnit.title')}
      style={{ fontWeight: 600 }}
    >
      {label}
    </button>
  );
}

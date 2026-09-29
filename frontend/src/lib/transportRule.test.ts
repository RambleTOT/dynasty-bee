import { describe, expect, it, vi } from 'vitest';
import { requiredTransportByRule, transportRuleText } from './booking';

// бэк без п. 55: прежнее правило D-06, где гигабит требует автомобиль
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, transportRuleNoGigabit: false } };
});

describe('правило транспорта до п. 55 бэка (флаг transportRuleNoGigabit выключен)', () => {
  it('гигабит, кабель и авария требуют машину', () => {
    expect(requiredTransportByRule('Конвергенция абонента', true)).toBe('car');
    expect(requiredTransportByRule('Работа с кабелем', false)).toBe('car');
    expect(requiredTransportByRule('Авария', false)).toBe('car');
    expect(requiredTransportByRule('Конвергенция абонента', false)).toBeNull();
    expect(transportRuleText()).toBe('кабель, гигабит, авария');
  });
});

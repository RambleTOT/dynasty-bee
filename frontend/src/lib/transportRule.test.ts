import { describe, expect, it, vi } from 'vitest';
import { requiredTransportByRule, transportRuleText } from './booking';

// п. 55 бэка выложен: правило D-06 без гигабита (D-40)
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, transportRuleNoGigabit: true } };
});

describe('правило транспорта без гигабита (флаг transportRuleNoGigabit)', () => {
  it('гигабит машину не требует, кабель и авария — требуют', () => {
    expect(requiredTransportByRule('Конвергенция абонента', true)).toBeNull();
    expect(requiredTransportByRule('Работа с кабелем', true)).toBe('car');
    expect(requiredTransportByRule('Авария', false)).toBe('car');
    expect(transportRuleText()).toBe('кабель, авария');
  });
});

import { describe, expect, it } from 'vitest';
import { engineerColors } from './colors';

describe('engineerColors', () => {
  it('цвет — позиция в ростере, отсортированном по id', () => {
    const colors = engineerColors(['E03', 'E01', 'E02']);
    expect(colors.get('E01')).toEqual({ index: 1, css: 'var(--route-1)', dashed: false });
    expect(colors.get('E02')?.index).toBe(2);
    expect(colors.get('E03')?.index).toBe(3);
  });

  it('числовая сортировка id и повтор цвета после 12 — пунктиром', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `E${i + 1}`);
    const colors = engineerColors(ids);
    expect(colors.get('E2')?.index).toBe(2);
    expect(colors.get('E10')?.index).toBe(10);
    expect(colors.get('E13')).toEqual({ index: 1, css: 'var(--route-1)', dashed: true });
    expect(colors.get('E14')?.dashed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import { buildDayMapData } from './dayMapData';
import styles from './DayMap.module.css';

const input = (patch: Partial<Parameters<typeof buildDayMapData>[0]> = {}) => ({
  model: overlayModel(),
  geojson: null,
  filters: { status: null, type: null },
  brigade: null,
  selectedRequest: null,
  ...patch,
});

describe('карта дня: маркеры и линии (Яндекс и OSM)', () => {
  it('снятые заявки не рисуем; вид маркера — по плану, аварии и назначению', () => {
    const data = buildDayMapData(input());
    const kinds = Object.fromEntries(data.markers.map((m) => [m.id, m.kind]));
    expect(kinds).toEqual({
      '305800001': 'stop',
      '305800002': 'stop',
      '305800003': 'stop',
      '305800004': 'stop',
      '305800007': 'urgent',
    });
    const done = data.markers.find((m) => m.id === '305800001')!;
    expect(done.html).toContain(styles.done);
    expect(done.sub).toMatch(/начало 10:05$/);
    expect(data.lines.map((l) => [l.key, l.colorVar])).toEqual([
      ['e1:false', expect.stringMatching(/^--route-\d+$/)],
      ['e2:false', expect.stringMatching(/^--route-\d+$/)],
    ]);
    expect(data.office).not.toBeNull();
    expect(data.fitKey).toBe('2026-09-29:east:P1:true');
  });

  it('чип бригады приглушает чужие маршруты и точки; выбранная заявка — выше остальных', () => {
    const data = buildDayMapData(input({ brigade: 'e1', selectedRequest: '305800002' }));
    const byId = new Map(data.markers.map((m) => [m.id, m]));
    expect(byId.get('305800002')!.dim).toBe(false);
    expect(byId.get('305800002')!.z).toBe(800);
    expect(byId.get('305800002')!.html).toContain(styles.selected);
    expect(byId.get('305800003')!.dim).toBe(true);
    expect(data.lines.find((l) => l.key.startsWith('e2'))!.dim).toBe(true);
  });

  it('до плана — нейтральные точки без линий', () => {
    const data = buildDayMapData(input({ model: overlayModel({ planState: 'none' }) }));
    expect(new Set(data.markers.map((m) => m.kind))).toEqual(new Set(['plain']));
    expect(data.lines).toEqual([]);
  });

  it('предложение: прежние линии изменённых бригад — серым пунктиром, остальные приглушены', () => {
    const model = overlayModel();
    const e1 = {
      engineerId: 'e1',
      points: [
        [55.74, 37.8],
        [55.75, 37.8],
      ] as [number, number][],
      road: false,
    };
    const data = buildDayMapData(
      input({
        model,
        highlight: { engineers: new Set(['e1']), lines: [e1], ghost: [e1], planId: 'P2' },
      }),
    );
    expect(data.lines[0]).toMatchObject({
      key: 'ghost-e1',
      ghost: true,
      colorVar: '--line-strong',
    });
    expect(data.lines.find((l) => l.key.startsWith('e2'))!.dim).toBe(true);
    expect(data.lines.find((l) => l.key === 'e1:false')).toBeDefined();
  });
});

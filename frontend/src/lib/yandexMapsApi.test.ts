import { describe, expect, it } from 'vitest';
import { routingMode } from './yandexMapsApi';

describe('routingMode', () => {
  it('по транспорту бригады; общественный — только между двумя точками', () => {
    expect(routingMode('car', 5)).toBe('auto');
    expect(routingMode('walk', 5)).toBe('pedestrian');
    expect(routingMode('bike', 5)).toBe('bicycle');
    expect(routingMode('public_transport', 2)).toBe('masstransit');
    expect(routingMode('public_transport', 4)).toBe('auto');
    expect(routingMode(null, 3)).toBe('auto');
  });
});

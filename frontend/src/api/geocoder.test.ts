import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExternalJson } from './client';
import { geocodeAddress, reverseAddress, suggestAddresses } from './geocoder';

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, ADDRESS_SUGGEST: { ...actual.ADDRESS_SUGGEST, url: 'https://photon.test' } };
});
vi.mock('./client', () => ({ fetchExternalJson: vi.fn(async () => null) }));

const lastUrl = () => new URL(vi.mocked(fetchExternalJson).mock.calls.at(-1)?.[0] as string);

beforeEach(() => vi.mocked(fetchExternalJson).mockClear());

describe('Photon: названия на языке местности, а не браузера', () => {
  it('подсказки, адрес точки и поиск точки заявки — с lang=default', async () => {
    await suggestAddresses('Химки, Молодёжная');
    expect(lastUrl().pathname).toBe('/api/');
    expect(lastUrl().searchParams.get('lang')).toBe('default');

    await reverseAddress(55.72, 37.61);
    expect(lastUrl().pathname).toBe('/reverse');
    expect(lastUrl().searchParams.get('lang')).toBe('default');

    await geocodeAddress('Химки, улица Молодёжная, 4', { lat: 55.89, lon: 37.43 });
    expect(lastUrl().searchParams.get('lang')).toBe('default');
    expect(lastUrl().searchParams.get('lat')).toBe('55.89');
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestAddresses } from '@/api/geocoder';
import type { AddressSuggestion } from '@/adapters/address';
import { AddressInput } from './AddressInput';

vi.mock('@/api/geocoder', () => ({
  addressSuggestEnabled: true,
  suggestAddresses: vi.fn(),
  reverseAddress: vi.fn(),
}));

const PHOTON = {
  features: [
    {
      geometry: { coordinates: [37.6107, 55.7577] },
      properties: { osm_type: 'R', osm_id: 1, street: 'Тверская улица', housenumber: '7', city: 'Москва', district: 'Тверской' },
    },
    {
      geometry: { coordinates: [37.59, 55.77] },
      properties: { osm_type: 'W', osm_id: 2, street: '1-я Тверская-Ямская улица', housenumber: '7', city: 'Москва' },
    },
  ],
};

function Field({ onPick, local }: { onPick: (s: AddressSuggestion) => void; local?: AddressSuggestion[] }) {
  const [value, setValue] = useState('');
  return (
    <AddressInput label="Адрес" value={value} onChange={setValue} onPick={onPick} localSuggestions={local} withMap={false} />
  );
}

function renderField(local?: AddressSuggestion[]) {
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Field onPick={onPick} local={local} />
    </QueryClientProvider>,
  );
  return onPick;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(suggestAddresses).mockResolvedValue(PHOTON);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('AddressInput — подсказки адреса', () => {
  it('ввод → подсказки Москвы → стрелка и Enter: адрес с координатами', async () => {
    const onPick = renderField();
    const input = screen.getByRole('combobox', { name: 'Адрес' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Тверская 7' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(suggestAddresses).toHaveBeenCalledWith('Тверская 7', expect.anything());
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Тверская улица, 7Москва, Тверской',
      '1-я Тверская-Ямская улица, 7Москва',
    ]);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Москва, Тверская улица, 7');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ lat: 55.7577, lon: 37.6107 }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('свои подсказки (адреса заявок дня) — первыми, по вхождению', async () => {
    vi.mocked(suggestAddresses).mockResolvedValue({ features: [] });
    const onPick = renderField([
      { id: 'day-1', title: 'ул. Примерная, д. 21', subtitle: 'Адрес заявки №1', value: 'ул. Примерная, д. 21', lat: 55.7, lon: 37.7 },
    ]);
    const input = screen.getByRole('combobox', { name: 'Адрес' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'примерная' } });
    const option = await screen.findByRole('option', { name: /ул\. Примерная, д\. 21/ });
    fireEvent.mouseDown(option);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'day-1' }));
  });
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooking, getSlots } from '@/api/booking';
import { getRegions } from '@/api/data';
import { ApiError } from '@/api/errors';
import type { BookingSlotsResponse } from '@/api/types';
import { dismissAll } from '@/lib/notify';
import { renderScreen } from '../testUtils';
import NewRequestPage from './NewRequestPage';

vi.mock('@/api/booking', () => ({ getSlots: vi.fn(), createBooking: vi.fn() }));
vi.mock('@/api/data', () => ({ getRegions: vi.fn() }));
// здесь — обычная запись без вкладки «Авария»; вкладку проверяет EmergencyForm.test.tsx
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, emergencyByRegion: false } };
});

const WINDOWS = [
  '10:00-12:00',
  '12:00-14:00',
  '14:00-16:00',
  '16:00-18:00',
  '18:00-20:00',
  '20:00-22:00',
];

function slotsResponse(busy: string[] = [], date = '2026-09-29'): BookingSlotsResponse {
  return {
    region_id: 'east',
    date,
    required_skill: 'installation',
    duration_minutes: 70,
    slots: WINDOWS.map((window) => ({ window, available: !busy.includes(window) })),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z')); // 12:00 по Москве, завтра — 29.09
  vi.mocked(getRegions).mockResolvedValue([]);
  vi.mocked(getSlots).mockImplementation(async (query) =>
    slotsResponse(['10:00-12:00'], query.date),
  );
});

afterEach(() => {
  act(() => dismissAll());
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderNew() {
  return renderScreen(<NewRequestPage />, { path: '/operator/new', url: '/operator/new' });
}

/** Шаг 1: Восток (первый регион), адрес, «Подключение» → HD по умолчанию. */
async function fillStepOne() {
  renderNew();
  fireEvent.change(screen.getByRole('combobox', { name: 'Адрес' }), {
    target: { value: 'ул. Тестовая, д. 1' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Тип заявки BK' }), {
    target: { value: 'Подключение' },
  });
  expect(
    await screen.findByText('Навык: Подключение и дозаказ · 70 мин на адресе'),
  ).toBeInTheDocument();
}

async function goToSlots() {
  await fillStepOne();
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату и окно' }));
  await screen.findByRole('button', { name: /14–16/ });
}

describe('O-01 шаг 1', () => {
  it('флаг emergencyByRegion выключен: вкладок нет, tab=emergency — обычная форма', () => {
    renderScreen(<NewRequestPage />, {
      path: '/operator/new',
      url: '/operator/new?tab=emergency',
    });
    expect(screen.queryByRole('tab', { name: 'Авария' })).not.toBeInTheDocument();
    expect(screen.getByText('Шаг 1 из 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать дату и окно' })).toBeInTheDocument();
  });

  it('регион по умолчанию, HD по BK, строка навыка из фоновых окон', async () => {
    renderNew();
    expect(screen.getByText('Шаг 1 из 2')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Восток' })).toHaveAttribute('aria-selected', 'true');
    const next = screen.getByRole('button', { name: 'Выбрать дату и окно' });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Адрес' }), {
      target: { value: 'ул. Тестовая, д. 1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Тип заявки BK' }), {
      target: { value: 'Подключение' },
    });
    expect(screen.getByRole('combobox', { name: 'Тип заявки HD' })).toHaveValue(
      'Конвергенция абонента',
    );
    expect(
      await screen.findByText('Навык: Подключение и дозаказ · 70 мин на адресе'),
    ).toBeInTheDocument();
    expect(next).toBeEnabled();
    expect(getSlots).toHaveBeenLastCalledWith(
      {
        region_id: 'east',
        date: '2026-09-29',
        type_bk: 'Подключение',
        type_hd: 'Конвергенция абонента',
        address: 'ул. Тестовая, д. 1',
        gigabit: false,
        required_transport: undefined,
      },
      expect.anything(),
    );
  });

  it('гигабит → «Автомобиль» по правилу; ручной выбор правило не трогает', async () => {
    await fillStepOne();
    const transport = screen.getByRole('combobox', { name: /Требуемый транспорт/ });
    expect(transport).toHaveValue('none');
    fireEvent.click(screen.getByRole('switch', { name: 'Гигабит' }));
    expect(transport).toHaveValue('car');
    expect(screen.getByText('по правилу')).toBeInTheDocument();
    fireEvent.change(transport, { target: { value: 'walk' } });
    expect(screen.queryByText('по правилу')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Гигабит' }));
    expect(transport).toHaveValue('walk');
  });

  it('технология — только для Востока; неполный телефон не пускает дальше', async () => {
    await fillStepOne();
    expect(screen.getByRole('button', { name: 'FMC' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Югоцентр' }));
    expect(screen.queryByRole('button', { name: 'FMC' })).not.toBeInTheDocument();
    const phone = screen.getByRole('textbox', { name: 'Контакт клиента · необязательно' });
    fireEvent.change(phone, { target: { value: '8916' } });
    expect(phone).toHaveValue('+7 (916');
    fireEvent.blur(phone);
    expect(screen.getByText('Номер — 11 цифр')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать дату и окно' })).toBeDisabled();
    fireEvent.change(phone, { target: { value: '+7 (916) 123-42-18' } });
    expect(screen.getByRole('button', { name: 'Выбрать дату и окно' })).toBeEnabled();
  });
});

describe('O-01.2 дата и окно', () => {
  it('завтра по умолчанию; занятое окно не нажимается; без окна — «Выберите окно»', async () => {
    await goToSlots();
    expect(screen.getByText('Шаг 2 из 2 · свободные окна обновляются')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вт, 29.09' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('button', { name: /^\d+–\d+/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: /10–12/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Выберите окно' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /14–16/ }));
    expect(screen.getByRole('button', { name: /14–16/ })).toHaveTextContent('выбрано');
    expect(screen.getByRole('button', { name: 'Записать на 14:00–16:00' })).toBeEnabled();
  });

  it('смена даты — окна этой даты, выбор снят', async () => {
    await goToSlots();
    fireEvent.click(screen.getByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ср, 30.09' }));
    await waitFor(() =>
      expect(getSlots).toHaveBeenLastCalledWith(
        expect.objectContaining({ date: '2026-09-30' }),
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Выберите окно' })).toBeDisabled();
  });

  it('«Изменить» — шаг 1 с сохранёнными полями', async () => {
    await goToSlots();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(screen.getByRole('combobox', { name: 'Адрес' })).toHaveValue('ул. Тестовая, д. 1');
    expect(screen.getByRole('combobox', { name: 'Тип заявки BK' })).toHaveValue('Подключение');
  });

  it('запись: тост с №, сразу пустой шаг 1 (регион остался); «Открыть» — заявка в поиске', async () => {
    vi.mocked(createBooking).mockResolvedValue({
      request_id: '305881207',
      scenario_id: 'S1',
      status: 'planned',
      window: '14:00-16:00',
    });
    await goToSlots();
    fireEvent.click(screen.getByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать на 14:00–16:00' }));
    expect(
      await screen.findByText('Заявка №305881207 записана на 29.09, 14–16. План дня пересчитан'),
    ).toBeInTheDocument();
    expect(createBooking).toHaveBeenCalledWith({
      region_id: 'east',
      date: '2026-09-29',
      window: '14:00-16:00',
      type_bk: 'Подключение',
      type_hd: 'Конвергенция абонента',
      address: 'ул. Тестовая, д. 1',
      district: undefined,
      gigabit: false,
      technology: 'FMC',
      required_transport: null,
      client_contact: undefined,
    });
    expect(screen.getByText('Шаг 1 из 2')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Адрес' })).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'Восток' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/operator?q=305881207&request=305881207&region=east&date=2026-09-29',
    );
  });

  it('409 SLOT_TAKEN — плашка, выбор снят, окна запрошены заново', async () => {
    vi.mocked(createBooking).mockRejectedValue(
      new ApiError(409, 'SLOT_TAKEN', 'Нет подходящего инженера'),
    );
    await goToSlots();
    const callsBefore = vi.mocked(getSlots).mock.calls.length;
    vi.mocked(getSlots).mockImplementation(async (query) =>
      slotsResponse(['10:00-12:00', '14:00-16:00'], query.date),
    );
    fireEvent.click(screen.getByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать на 14:00–16:00' }));
    expect(
      await screen.findByText('Это окно только что заняли. Выберите другое'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Нет подходящего инженера')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выберите окно' })).toBeDisabled();
    await waitFor(() => expect(vi.mocked(getSlots).mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.getByRole('button', { name: /14–16/ })).toBeDisabled());
    // выбор другого окна убирает плашку
    fireEvent.click(screen.getByRole('button', { name: /16–18/ }));
    expect(
      screen.queryByText('Это окно только что заняли. Выберите другое'),
    ).not.toBeInTheDocument();
  });

  it('⏳ 9.5: свежие окна из details.slots — без перезапроса', async () => {
    const fresh = slotsResponse(['10:00-12:00', '14:00-16:00']).slots;
    vi.mocked(createBooking).mockRejectedValue(
      new ApiError(409, 'SLOT_TAKEN', 'Окно 14:00-16:00 уже занято', { slots: fresh }),
    );
    await goToSlots();
    const callsBefore = vi.mocked(getSlots).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать на 14:00–16:00' }));
    await screen.findByText('Это окно только что заняли. Выберите другое');
    const slot = screen.getByRole('button', { name: /14–16/ });
    expect(slot).toBeDisabled();
    expect(within(slot).getByText('занято')).toBeInTheDocument();
    expect(vi.mocked(getSlots).mock.calls.length).toBe(callsBefore);
  });

  it('ошибка окон — «Не удалось загрузить окна» и «Повторить»', async () => {
    await goToSlots();
    vi.mocked(getSlots).mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'нет сети'));
    fireEvent.click(screen.getByRole('button', { name: 'Ср, 30.09' }));
    expect(await screen.findByText('Не удалось загрузить окна')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: /14–16/ })).toBeEnabled();
  });
});

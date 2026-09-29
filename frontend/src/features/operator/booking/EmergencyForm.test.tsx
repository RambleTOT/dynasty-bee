import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOperatorEmergency, getSlots } from '@/api/booking';
import { getRegions } from '@/api/data';
import { ApiError } from '@/api/errors';
import { dismissAll } from '@/lib/notify';
import { renderScreen } from '../testUtils';
import { emergencyInput, emergencyWindowEnd } from './emergency';
import NewRequestPage from './NewRequestPage';

vi.mock('@/api/booking', () => ({
  getSlots: vi.fn(),
  createBooking: vi.fn(),
  applyOperatorEmergency: vi.fn(),
}));
vi.mock('@/api/data', () => ({ getRegions: vi.fn() }));
// ⏳ 9.1 готова: авария оператора по региону
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, emergencyByRegion: true } };
});

const NOW = new Date('2026-09-28T09:30:00Z'); // 12:30 по Москве

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.mocked(getRegions).mockResolvedValue([]);
  vi.mocked(getSlots).mockResolvedValue({
    region_id: 'east',
    date: '2026-09-29',
    required_skill: 'emergency',
    duration_minutes: 80,
    slots: [],
  });
});

afterEach(() => {
  act(() => dismissAll());
  vi.useRealTimers();
  vi.clearAllMocks();
});

function openEmergency() {
  renderScreen(<NewRequestPage />, { path: '/operator/new', url: '/operator/new' });
  fireEvent.click(screen.getByRole('tab', { name: 'Авария' }));
}

describe('O-01 вкладка «Авария»', () => {
  it('вкладка — в адресе, шапка без «Шаг 1 из 2», окна не запрашиваются', () => {
    openEmergency();
    expect(screen.getByTestId('location')).toHaveTextContent('/operator/new?tab=emergency');
    expect(screen.queryByText('Шаг 1 из 2')).not.toBeInTheDocument();
    expect(
      screen.getByText('Аварию распределит диспетчер — дата и окно не нужны'),
    ).toBeInTheDocument();
    // D-37: у аварии HD только «Авария», поле только для чтения
    const hd = screen.getByRole('textbox', { name: 'Тип заявки HD' });
    expect(hd).toHaveValue('Авария');
    expect(hd).toHaveAttribute('readonly');
    expect(screen.getByRole('combobox', { name: 'Требуемый транспорт' })).toHaveValue('car');
    expect(screen.getByRole('button', { name: 'Передать диспетчеру' })).toBeDisabled();
    expect(getSlots).not.toHaveBeenCalled();
  });

  it('«Передать диспетчеру» → без plan_id и event_time, тост, форма очищена', async () => {
    vi.mocked(applyOperatorEmergency).mockResolvedValue(
      {} as Awaited<ReturnType<typeof applyOperatorEmergency>>,
    );
    openEmergency();
    fireEvent.change(screen.getByRole('combobox', { name: 'Адрес' }), {
      target: { value: ' ул. Тестовая, д. 7 (ТКД) ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий' }), {
      target: { value: 'Нет связи у подъезда' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Передать диспетчеру' }));
    expect(
      await screen.findByText('Авария передана диспетчеру. Он получит предложение, кто поедет'),
    ).toBeInTheDocument();
    expect(applyOperatorEmergency).toHaveBeenCalledWith({
      regionId: 'east',
      comment: 'Нет связи у подъезда',
      request: {
        id: `U-${NOW.getTime().toString(36).toUpperCase()}`,
        address: 'ул. Тестовая, д. 7 (ТКД)',
        duration_minutes: 80,
        window_start: '12:30',
        window_end: '22:00',
        priority: 'urgent',
        required_skill: 'emergency',
        required_transport: 'car',
        type_bk: 'Глобальная проблема',
        type_hd: 'Авария',
        source: 'operator',
      },
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Адрес' })).toHaveValue(''));
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveValue('');
  });

  it('409 — danger-плашка с текстом бэка, без тоста', async () => {
    vi.mocked(applyOperatorEmergency).mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'Рабочий день в регионе Восток ещё не начат'),
    );
    openEmergency();
    fireEvent.change(screen.getByRole('combobox', { name: 'Адрес' }), {
      target: { value: 'ул. Тестовая, д. 7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Передать диспетчеру' }));
    expect(
      await screen.findByText('Рабочий день в регионе Восток ещё не начат'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Рабочий день в регионе Восток');
    expect(screen.getByRole('combobox', { name: 'Адрес' })).toHaveValue('ул. Тестовая, д. 7');
  });
});

describe('тело аварии', () => {
  it('пустой комментарий не шлём; «Информация» и другой транспорт — как выбрали', () => {
    const input = emergencyInput(
      {
        region: 'south_east',
        typeHd: 'Информация',
        address: 'ул. Т',
        transport: 'walk',
        comment: '  ',
      },
      '10:05',
      'U-1',
    );
    expect(input.comment).toBeUndefined();
    expect(input.regionId).toBe('south_east');
    expect(input.request).toMatchObject({
      id: 'U-1',
      window_start: '10:05',
      window_end: '22:00',
      required_transport: 'walk',
      type_hd: 'Информация',
    });
  });

  it('после 22:00 окно-заглушка не выворачивается', () => {
    expect(emergencyWindowEnd('21:59')).toBe('22:00');
    expect(emergencyWindowEnd('22:00')).toBe('23:59');
    expect(emergencyWindowEnd('23:10')).toBe('23:59');
  });
});

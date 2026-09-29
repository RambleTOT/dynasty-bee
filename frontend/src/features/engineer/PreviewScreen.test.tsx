import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, postAction } from '@/api/engineer';
import type { EngineerMeDay } from '@/api/types';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import EngineerApp from './EngineerApp';
import { FEATURES } from '@/config';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

type ActionResult = Awaited<ReturnType<typeof postAction>>;

const beforeShift = (extra: Partial<EngineerMeDay> = {}) =>
  dayRaw(
    [
      visitRaw('305871402', 1, 'planned', { flags: ['urgent'], arrival: '10:20' }),
      visitRaw('305866318', 2, 'planned', { arrival: '11:50', duration_minutes: 30 }),
    ],
    { shift_status: 'not_started', summary: { total: 9, first_start: '10:20' }, ...extra },
  );

const renderApp = () => renderEngineer({ home: <EngineerApp /> });

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
  vi.mocked(postAction).mockReset();
});

describe('E-01 «Превью до начала смены»', () => {
  it('карточка дня и лента по времени прибытия', async () => {
    vi.mocked(getMyDay).mockResolvedValue(beforeShift());
    renderApp();
    expect(await screen.findByText('Сегодня, 29 сентября')).toBeInTheDocument();
    expect(screen.getByText('9 заявок, первая в 10:20')).toBeInTheDocument();
    expect(screen.getByText('Старт: офис, ул.Юных Ленинцев, д. 83 стр. 4')).toBeInTheDocument();

    const stops = within(screen.getByRole('list', { name: 'Заявки по времени' })).getAllByRole(
      'listitem',
    );
    expect(stops).toHaveLength(2);
    expect(stops[0]).toHaveTextContent('10:20');
    expect(stops[0]).toHaveTextContent('Прибытие ≈ 10:20 · 70 мин · окно 14–16');
    expect(stops[0]).toHaveTextContent('ул.Окская, д. 1, кв. 13');
    expect(within(stops[0]).getByText('Срочная')).toBeInTheDocument();
    expect(stops[1]).toHaveTextContent('Прибытие ≈ 11:50 · 30 мин · окно 14–16');
    // каждая заявка открывает свою карточку
    expect(within(stops[1]).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('305866318'),
    );
    // до смены кнопок статуса нет
    expect(screen.queryByRole('button', { name: 'Отправиться в путь' })).toBeNull();
    // «Не выйду сегодня» — бэк принимает unavailable до смены (8.5, флаг unavailableBeforeShift)
    if (FEATURES.unavailableBeforeShift) {
      expect(screen.getByRole('button', { name: 'Не выйду сегодня' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('button', { name: 'Не выйду сегодня' })).toBeNull();
    }
  });

  it('адреса старта нет — «Старт: офис»', async () => {
    const day = beforeShift();
    day.engineer.start = { kind: 'office' };
    vi.mocked(getMyDay).mockResolvedValue(day);
    renderApp();
    expect(await screen.findByText('Старт: офис')).toBeInTheDocument();
  });
});

describe('E-02 «На чём сегодня?»', () => {
  it('по умолчанию — транспорт по справочнику; «Поехали» → shift_start с транспортом', async () => {
    vi.mocked(getMyDay).mockResolvedValue(beforeShift());
    vi.mocked(postAction).mockResolvedValue({
      engineer_id: 'E01',
      action: 'shift_start',
      status: 'ok',
    } as ActionResult);
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Начать смену' }));
    const sheet = await screen.findByRole('dialog', { name: 'На чём сегодня?' });
    expect(within(sheet).getByRole('radio', { name: /Автомобиль/ })).toBeChecked();
    expect(within(sheet).getByText('по справочнику')).toBeInTheDocument();
    expect(within(sheet).queryByText(/передадут другим инженерам/)).toBeNull();

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Общественный транспорт' }));
    expect(
      within(sheet).getByText(
        'Заявки, где нужен автомобиль, передадут другим инженерам после решения диспетчера',
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Поехали' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'shift_start',
        payload: { transport: 'public_transport' },
      }),
    );
    // не по справочнику — ещё предложение диспетчеру: на shift_start бэк его не создаёт
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'transport_changed',
        payload: { transport: 'public_transport' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('транспорт по справочнику — только shift_start', async () => {
    vi.mocked(getMyDay).mockResolvedValue(beforeShift());
    vi.mocked(postAction).mockResolvedValue({
      engineer_id: 'E01',
      action: 'shift_start',
      status: 'ok',
    } as ActionResult);
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Начать смену' }));
    const sheet = await screen.findByRole('dialog', { name: 'На чём сегодня?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Поехали' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postAction).toHaveBeenCalledTimes(1);
  });
});

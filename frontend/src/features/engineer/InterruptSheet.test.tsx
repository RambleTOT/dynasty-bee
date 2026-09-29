import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, getMyRoute, postAction } from '@/api/engineer';
import { ApiError } from '@/api/errors';
import type { EngineerMeDay } from '@/api/types';
import { notify } from '@/lib/notify';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import { hideDoneToast } from './doneToastStore';
import EngineerApp from './EngineerApp';

const flags = vi.hoisted(() => ({
  dayClock: false,
  failOther: false,
  engineerIncident: false,
  unavailableBeforeShift: false,
  emergencyByRegion: false,
  cancelComment: false,
  addEngineerAfterPublish: false,
}));

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  FEATURES: flags,
}));
vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

type ActionResult = Awaited<ReturnType<typeof postAction>>;

const response = (action: string, day?: EngineerMeDay) =>
  ({ engineer_id: 'E01', action, status: 'ok', day }) as unknown as ActionResult;

/** День: заявка №…1402 в работе, следующая — №…6318. После `fail` бэк переводит её в «Отменяется». */
function serveDay() {
  let day = dayRaw([visitRaw('305871402', 4, 'in_progress'), visitRaw('305866318', 5, 'planned')], {
    active_request_id: '305871402',
    summary: { total: 9 },
  });
  vi.mocked(getMyDay).mockImplementation(async () => day);
  vi.mocked(postAction).mockImplementation(async (body) => {
    const status =
      body.payload?.reason === 'client_reschedule' ? 'reschedule_pending' : 'cancel_pending';
    day = {
      ...day,
      active_request_id: null,
      visits: (day.visits ?? []).map((visit) =>
        visit.request_id === body.request_id ? { ...visit, status } : visit,
      ),
    };
    return response(body.action, day);
  });
}

async function openSheet() {
  renderEngineer({ home: <EngineerApp /> });
  fireEvent.click(await screen.findByRole('button', { name: 'Прервать' }));
  return screen.findByRole('dialog', { name: 'Прервать выполнение' });
}

const submit = (sheet: HTMLElement) =>
  fireEvent.click(within(sheet).getByRole('button', { name: 'Отправить диспетчеру' }));

beforeEach(() => {
  flags.failOther = false;
  vi.mocked(getMyDay).mockReset();
  vi.mocked(getMyRoute).mockReset();
  vi.mocked(postAction).mockReset();
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  act(() => hideDoneToast());
});

describe('E-06 «Прервать выполнение»', () => {
  it('клиент отказался → fail; заявка уходит в «Далее» с «Отменяется», текущей стала следующая', async () => {
    serveDay();
    const sheet = await openSheet();
    expect(within(sheet).getByText('№305871402 · ул.Окская, д. 4')).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: 'Клиент отказался' })).toBeChecked();
    expect(within(sheet).queryByRole('radio', { name: 'Другое' })).toBeNull();

    submit(sheet);
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'fail',
        request_id: '305871402',
        payload: { reason: 'client_refused' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(notify).toHaveBeenCalledWith(
      'Отправлено диспетчеру. Можно ехать к следующей заявке',
      'success',
    );

    expect(await screen.findByText('ТЕКУЩАЯ · 5 ИЗ 9')).toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Далее по маршруту' });
    const [first] = within(next).getAllByRole('link');
    expect(first).toHaveTextContent('Ждёт решения диспетчера');
    expect(within(first).getByText('Отменяется')).toBeInTheDocument();
  });

  it('нет доступа — reason no_access', async () => {
    serveDay();
    const sheet = await openSheet();
    fireEvent.click(
      within(sheet).getByRole('radio', { name: 'Нет доступа или техническая причина' }),
    );
    submit(sheet);
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'fail',
        request_id: '305871402',
        payload: { reason: 'no_access' },
      }),
    );
  });

  it('перенос — без даты не отправляем; дата с завтра до +14 дней', async () => {
    serveDay();
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Клиент просит перенести' }));
    const date = within(sheet).getByLabelText('Желаемая дата');
    expect(date).toHaveAttribute('min', '2026-09-30');
    expect(date).toHaveAttribute('max', '2026-10-13');

    submit(sheet);
    expect(await within(sheet).findByText('Укажите желаемую дату')).toBeInTheDocument();
    expect(postAction).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: '2026-10-01' } });
    submit(sheet);
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'fail',
        request_id: '305871402',
        payload: { reason: 'client_reschedule', desired_date: '2026-10-01' },
      }),
    );
    const next = await screen.findByRole('region', { name: 'Далее по маршруту' });
    expect(await within(next).findByText('Переносится')).toBeInTheDocument();
  });

  it('«Другое» — по флагу failOther; текст обязателен; COMMENT_REQUIRED подсвечивает поле', async () => {
    flags.failOther = true;
    serveDay();
    vi.mocked(postAction).mockRejectedValueOnce(
      new ApiError(422, 'COMMENT_REQUIRED', 'Опишите причину отмены'),
    );
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Другое' }));

    submit(sheet);
    expect(await within(sheet).findByText('Обязательное поле')).toBeInTheDocument();
    expect(postAction).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText('Опишите причину'), {
      target: { value: 'Нет ключа от щитка' },
    });
    submit(sheet);
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'fail',
        request_id: '305871402',
        payload: { reason: 'other', comment: 'Нет ключа от щитка' },
      }),
    );
    expect(await within(sheet).findByText('Опишите причину отмены')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Опишите причину')).toHaveAttribute('aria-invalid', 'true');
    expect(notify).not.toHaveBeenCalled();
  });

  it('шторка открывается из адреса ?sheet=interrupt — для текущей заявки', async () => {
    serveDay();
    renderEngineer({ home: <EngineerApp /> }, '/engineer?sheet=interrupt');
    const sheet = await screen.findByRole('dialog', { name: 'Прервать выполнение' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/engineer$/);
    expect(sheet).not.toBeInTheDocument();
  });
});

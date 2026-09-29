import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookingItem } from '@/adapters/booking';
import { cancelBooking } from '@/api/booking';
import { ApiError } from '@/api/errors';
import { dismissAll } from '@/lib/notify';
import { renderScreen } from '../testUtils';
import { CancelBlock } from './CancelBlock';

vi.mock('@/api/booking', () => ({ cancelBooking: vi.fn() }));
// ⏳ 9.3 готова: причина «Другое» с комментарием
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, cancelComment: true } };
});

const item: BookingItem = {
  id: '100001',
  regionId: 'east',
  date: '2026-09-29',
  window: '18:00-20:00',
  address: 'ул. Тестовая, д. 1',
  typeBk: 'Подключение',
  status: 'planned',
};

afterEach(() => {
  act(() => dismissAll());
  vi.clearAllMocks();
});

function renderBlock(onClose = vi.fn()) {
  renderScreen(<CancelBlock item={item} onClose={onClose} />, {
    path: '/operator',
    url: '/operator',
  });
  return onClose;
}

describe('CancelBlock при cancelComment', () => {
  it('«Другое» без текста — кнопка неактивна, с текстом — reason other + comment', async () => {
    vi.mocked(cancelBooking).mockResolvedValue({ status: 'cancelled', message: 'Отменена' });
    const onClose = renderBlock();
    fireEvent.click(screen.getByRole('radio', { name: 'Другое' }));
    const submit = screen.getByRole('button', { name: 'Отменить заявку' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Опишите причину' }), {
      target: { value: '  Клиент переезжает ' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText('Отменена')).toBeInTheDocument();
    expect(cancelBooking).toHaveBeenCalledWith(
      '100001',
      { reason: 'other', comment: 'Клиент переезжает' },
      { regionId: 'east', date: '2026-09-29' },
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('422 COMMENT_REQUIRED — подсветка поля «Опишите причину»', async () => {
    vi.mocked(cancelBooking).mockRejectedValue(
      new ApiError(422, 'COMMENT_REQUIRED', 'Опишите причину отмены'),
    );
    const onClose = renderBlock();
    fireEvent.click(screen.getByRole('radio', { name: 'Другое' }));
    const comment = screen.getByRole('textbox', { name: 'Опишите причину' });
    fireEvent.change(comment, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявку' }));
    expect(await screen.findByText('Опишите причину отмены')).toBeInTheDocument();
    expect(comment).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });
});

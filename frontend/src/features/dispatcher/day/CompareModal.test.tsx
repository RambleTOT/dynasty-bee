import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayBaseline, overlayCompare, overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import { comparePlans, getBaseline } from '@/api/planning';
import { renderDay, testChain } from '@/test/dispatcherDay';
import { CompareModal } from './CompareModal';

vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  comparePlans: vi.fn(),
  getBaseline: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('DS-05 «Сравнение на весь экран»', () => {
  it('шапка, три колонки крупно с Δ, таблица «н / F / д» и сноска', async () => {
    vi.mocked(comparePlans).mockResolvedValue(overlayCompare);
    vi.mocked(getBaseline).mockResolvedValue(overlayBaseline);
    const onClose = vi.fn();
    renderDay(<CompareModal model={overlayModel()} chain={testChain} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', {
      name: 'Сравнение планов · Восток, Вт 29 сентября',
    });
    expect(within(dialog).getByText('Версия 4 · 5 заявок · 5 бригад')).toBeInTheDocument();

    // FIFO и диспетчер — после ответа бэка; «Наш план» — по плану, Δ — к FIFO
    expect(await within(dialog).findByText('25,0')).toBeInTheDocument();
    expect(within(dialog).getByText('18,6')).toBeInTheDocument();
    expect(within(dialog).getByText('−6,4 км (−26%)')).toBeInTheDocument();
    expect(within(dialog).getByText('−1 инженер')).toBeInTheDocument();
    expect(within(dialog).getByText('27,6')).toBeInTheDocument();
    expect(within(dialog).getByText('оценка')).toBeInTheDocument();
    // «Начато в окне» и «Просрочено» здесь не выводим — только три строки
    expect(within(dialog).queryByText('Начато в окне')).toBeNull();

    const table = within(dialog).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Бригада', 'Заявок н / F / д', 'Км наш', 'FIFO', 'Дисп.*']);
    const sokolov = within(table).getByRole('row', { name: /Соколов/ });
    expect(
      within(sokolov)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['Соколов', '2 / 1 / 1', '8,4', '8,0', '9,1']);
    const popov = within(table).getByRole('row', { name: /Попов/ });
    expect(
      within(popov)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['Попов', '— / 1 / 1', '—', '6,5', '7,2']);

    expect(
      within(dialog).getByText(
        /^Базовый вариант FIFO — заявки по порядку строк файла.*порядок визитов в выгрузке не указан\.$/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('до плана: «Наш план» — прочерки и подсказка; сравнение не ответило — «—»', async () => {
    vi.mocked(comparePlans).mockRejectedValue(new Error('offline'));
    renderDay(
      <CompareModal
        model={overlayModel({ planState: 'none' })}
        chain={testChain}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /^Сравнение планов/ });
    expect(within(dialog).getByText('5 заявок · 5 бригад')).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        'Нажмите «Построить план», чтобы заполнить колонку «Наш план».',
      ),
    ).toBeInTheDocument();
    expect(getBaseline).not.toHaveBeenCalled();
    expect(within(dialog).queryByText('18,6')).toBeNull();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { Car } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissAll, notify, NotifyProvider } from '@/lib/notify';
import { Button } from './Button';
import { FlagChip, StatusChip } from './Chip';
import { RadioCards } from './Choice';
import { Select } from './Field';
import { Modal } from './Overlay';
import { FilterPill } from './Popover';
import { SegmentedControl } from './SegmentedControl';

afterEach(() => {
  act(() => dismissAll());
  vi.useRealTimers();
});

describe('Button', () => {
  it('loading — неактивна, двойное нажатие исключено', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Построить план
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Построить план' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('чипы статусов и флагов', () => {
  it('подписи — из lib/statuses', () => {
    render(
      <>
        <StatusChip status="cancel_pending" />
        <FlagChip flag="late" />
        <FlagChip flag="changed" iconOnly />
        <FlagChip flag="urgent" />
      </>,
    );
    expect(screen.getByText('Отменяется')).toBeInTheDocument();
    expect(screen.getByText('Просрочена')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Изменено' })).toBeInTheDocument();
    expect(screen.getByText('Срочная')).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  function Harness() {
    const [value, setValue] = useState<'map' | 'timeline'>('map');
    return (
      <SegmentedControl
        label="Вид"
        value={value}
        onChange={setValue}
        options={[
          { value: 'map', label: 'Карта' },
          { value: 'timeline', label: 'Таймлайн', count: 3 },
        ]}
      />
    );
  }

  it('клик и стрелки переключают сегмент', () => {
    render(<Harness />);
    const map = screen.getByRole('tab', { name: 'Карта' });
    const timeline = screen.getByRole('tab', { name: /Таймлайн/ });
    expect(map).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(timeline);
    expect(timeline).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    expect(map).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RadioCards', () => {
  it('выбор строки', () => {
    const onChange = vi.fn();
    render(
      <RadioCards
        name="reason"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Клиент отказался' },
          { value: 'b', label: 'Ошибка записи', icon: Car, meta: 'по справочнику' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Клиент отказался' })).toBeChecked();
    fireEvent.click(screen.getByText('Ошибка записи'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Select', () => {
  it('подпись связана с полем, onChange отдаёт значение', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Регион"
        value="east"
        onChange={onChange}
        options={[
          { value: 'east', label: 'Восток' },
          { value: 'south_east', label: 'Юго-восток' },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Регион'), { target: { value: 'south_east' } });
    expect(onChange).toHaveBeenCalledWith('south_east');
  });
});

describe('Modal', () => {
  it('Esc закрывает, фокус уходит в окно и возвращается назад', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Событие">
            <input aria-label="Адрес" />
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Событие' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('окно поверх окна: Esc закрывает только верхнее', () => {
    function Harness() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          <Modal open={outer} onClose={() => setOuter(false)} title="Предложение" />
          <Modal open={inner} onClose={() => setInner(false)} title="Заявка" />
        </>
      );
    }
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Заявка' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Предложение' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('FilterPill', () => {
  it('один выбор; выбранное значение в подписи пилюли', () => {
    function Harness() {
      const [value, setValue] = useState('all');
      return (
        <FilterPill
          label="Регион"
          value={value}
          allValue="all"
          onChange={setValue}
          options={[
            { value: 'all', label: 'Все регионы' },
            { value: 'east', label: 'Восток' },
          ]}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Регион/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Восток' }));
    expect(screen.getByRole('button', { name: /Регион · Восток/ })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('notify', () => {
  it('скрывается через 4 с; одинаковые не дублируются; persistent висит до закрытия', () => {
    vi.useFakeTimers();
    render(<NotifyProvider>{null}</NotifyProvider>);
    act(() => {
      notify('План построен и опубликован', 'success');
      notify('План построен и опубликован', 'success');
    });
    expect(screen.getAllByText('План построен и опубликован')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(screen.queryByText('План построен и опубликован')).not.toBeInTheDocument();

    const onAgain = vi.fn();
    act(() => {
      notify('Заявка записана', 'success', {
        persistent: true,
        action: { label: 'Новая запись', onClick: onAgain },
      });
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Новая запись' }));
    expect(onAgain).toHaveBeenCalled();
    expect(screen.queryByText('Заявка записана')).not.toBeInTheDocument();
  });
});

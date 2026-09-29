import { Ellipsis } from 'lucide-react';
import type { EngineerDayModel } from '@/adapters/engineerDay';
import { useAuth } from '@/auth/useAuth';
import { ActionMenu, IconButton } from '@/ui';

/**
 * Меню ⋯ (D-31): «Не могу работать» и «Завершить смену» — только на смене; «Выйти» — всегда.
 * «Завершить смену» при заявке в пути или в работе не отправляет `shift_end` (бэк вернёт 409), а
 * объясняет, что сначала закрыть; при оставшихся заявках — предупреждает (ShiftEndConfirm).
 */
export function EngineerMenu({
  day,
  onUnavailable,
  onShiftEnd,
}: {
  day?: EngineerDayModel;
  onUnavailable: () => void;
  onShiftEnd: () => void;
}) {
  const { logout } = useAuth();
  const onShift = day?.engineer.shiftStatus === 'on_shift';
  const items = [
    ...(onShift
      ? [
          { label: 'Не могу работать', onSelect: onUnavailable },
          { label: 'Завершить смену', onSelect: onShiftEnd },
        ]
      : []),
    { label: 'Выйти', onSelect: () => void logout() },
  ];
  return (
    <ActionMenu
      items={items}
      trigger={({ open, toggle, id }) => (
        <IconButton
          icon={Ellipsis}
          label="Меню"
          variant="ghost"
          size="lg"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
        />
      )}
    />
  );
}

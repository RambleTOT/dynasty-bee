/**
 * Тексты оператора — дословно по FRONTEND_SPEC §8.3.11 (ключи те же) и подписи полей из макета
 * `design/Operator.html`. Даты и окна в шаблоны приходят уже отформатированными (lib/booking).
 */

/** «№305857695», без номера — пусто. */
const no = (id?: string) => (id ? ` №${id}` : '');

export const T = {
  search: {
    title: 'Найти заявку',
    placeholder: '№ заявки или адрес',
    hint: (count: number) => `По № заявки или адресу · найдено ${count}`,
    limit: 'Показаны первые 20 — уточните запрос',
    empty: 'Введите № заявки или адрес',
    notFound: 'Ничего не нашли. Проверьте номер или адрес',
    clear: 'Очистить поиск',
    window: (window: string) => `окно ${window}`,
  },
  card: {
    none: 'Выберите заявку слева',
    engineerNone: 'не назначен',
    region: 'Регион',
    dateWindow: 'Дата и окно',
    type: 'Тип',
    address: 'Адрес',
    district: 'Район',
    gigabit: 'Гигабит',
    engineer: 'Инженер',
    noAddress: 'Адрес не указан',
    yes: 'да',
    no: 'нет',
    reschedule: 'Перенести',
    cancel: 'Отменить',
  },
  cancel: {
    title: 'Отменить заявку?',
    reasons: {
      client_refused: 'Клиент отказался',
      booking_error: 'Ошибка записи',
      other: 'Другое',
    },
    comment: 'Опишите причину',
    back: 'Назад',
    submit: 'Отменить заявку',
    doneFuture: (date: string) => `Заявка отменена. План на ${date} пересчитан`,
    doneToday: 'Заявка отменена. Чем занять освободившееся окно, решит диспетчер',
  },
  new: {
    title: 'Новая запись',
    step1: 'Шаг 1 из 2',
    step2: 'Шаг 2 из 2 · свободные окна обновляются',
    tabs: { regular: 'Обычная заявка', emergency: 'Авария' },
    skill: (skill: string, minutes: number) => `Навык: ${skill} · ${minutes} мин на адресе`,
    byRule: 'по правилу',
    next: 'Выбрать дату и окно',
    edit: 'Изменить',
    region: 'Регион',
    address: 'Адрес',
    typeBk: 'Тип заявки BK',
    typeHd: 'Тип заявки HD',
    contact: 'Контакт клиента · необязательно',
    contactShort: 'Контакт клиента',
    phoneIncomplete: 'Номер — 11 цифр',
    transport: 'Требуемый транспорт',
    transportNone: 'Не требуется',
    gigabit: 'Гигабит',
    technology: 'Технология',
    typeSummary: 'Тип заявки',
    choose: 'Выберите',
    /** Сводка шага 2: «FMC · без гигабита»; без технологии — строка «Гигабит: да / нет». */
    technologyValue: (technology: string, gigabit: boolean) =>
      `${technology} · ${gigabit ? 'с гигабитом' : 'без гигабита'}`,
  },
  slots: {
    title: 'Дата и окно',
    free: 'свободно',
    busy: 'занято',
    selected: 'выбрано',
    none: (date: string) => `На ${date} свободных окон нет. Выберите другую дату`,
    error: 'Не удалось загрузить окна',
    taken: 'Это окно только что заняли. Выберите другое',
    pick: 'Выберите окно',
    back: 'Назад',
    dates: 'Дата',
    windows: 'Окна',
    /** Кнопка календаря в ленте дат и его окно. */
    calendar: 'Выбрать дату в календаре',
    calendarTitle: 'Выберите дату',
    prevMonth: 'Предыдущий месяц',
    nextMonth: 'Следующий месяц',
  },
  book: {
    cta: (window: string) => `Записать на ${window}`,
    okPlanned: (id: string | undefined, date: string, window: string) =>
      `Заявка${no(id)} записана на ${date}, ${window}. План дня пересчитан`,
    okUnassigned: (id: string | undefined, date: string, window: string) =>
      `Заявка${no(id)} записана на ${date}, ${window}, но бригаду в это окно не поставить — назначит диспетчер`,
    unassignedHint: 'Все бригады в это окно заняты. Предложите клиенту другое окно или предупредите диспетчера',
    okRecalc: (date: string, window: string) =>
      `Заявка записана на ${date}, ${window}. План дня пересчитывается`,
    /** Кнопка тоста о записи: к заявке в поиске. */
    open: 'Открыть',
  },
  resch: {
    title: (id: string) => `Перенос заявки №${id}`,
    now: (date: string, window: string) => `Сейчас: ${date}, ${window}`,
    cta: (window: string) => `Перенести на ${window}`,
    ok: (id: string, date: string, window: string) =>
      `Заявка №${id} перенесена на ${date}, ${window}`,
    current: 'Дата и окно сейчас',
    /** Шагов у переноса нет — только вторая часть подписи O-01.2 [Д]. */
    caption: 'Свободные окна обновляются',
  },
  crash: {
    addressNotFound:
      'Адрес не нашли на карте. Выберите вариант из подсказок или отметьте точку на карте',
    note: 'Аварию распределит диспетчер — дата и окно не нужны',
    cta: 'Передать диспетчеру',
    ok: 'Авария передана диспетчеру. Он получит предложение, кто поедет',
    comment: 'Комментарий',
  },
  net: {
    error: 'Не удалось связаться с сервером',
  },
  validation: 'Проверьте заполнение полей',
  retry: 'Повторить',
} as const;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** База API. По умолчанию `/api/v1` — в dev через прокси Vite. */
  readonly VITE_API_URL?: string;
  /** `true` — все ручки обслуживает имитация бэка на MSW (src/mocks). */
  readonly VITE_USE_MOCKS?: string;
  /** Список флагов FEATURES через запятую, которые включить (FRONTEND_SPEC §5.4). */
  readonly VITE_FEATURES?: string;
  /** Ключ «JavaScript API и HTTP Геокодер» Яндекс Карт: встроенная карта с маршрутом. Без ключа — OSM. */
  readonly VITE_YANDEX_MAPS_KEY?: string;
  /** Photon для подсказок адресов (по умолчанию photon.komoot.io); `off` — без подсказок. */
  readonly VITE_ADDRESS_SUGGEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

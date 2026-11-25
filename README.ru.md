# Ommesh Mini-Apps

Официальный каталог, исходный код, стартовые шаблоны и инструменты сборки мини-приложений (`.omapp`) для **Ommesh**.

[English](README.md) · **Русский**

Мини-приложения работают внутри Ommesh (компьютер, браузер, Android и iOS) в изолированном `iframe` (`sandbox="allow-scripts"`, `connect-src 'none'`) и общаются с радио, локальным хранилищем, контактами и уведомлениями только через [`@ommesh/miniapp-sdk`](https://github.com/cm4ker/ommesh/tree/master/packages/miniapp-sdk).

> Полная документация SDK и интерактивный портал методов находятся в основном репозитории Ommesh:
> - [Руководство по SDK](https://github.com/cm4ker/ommesh/blob/master/packages/miniapp-sdk/README.md)
> - [Справочник методов SDK (RU)](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk.ru.md) · [SDK Reference (EN)](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk.md)
> - [Интерактивный портал методов и песочница](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk-portal.html)

## Официальный каталог

| Приложение | ID | `appId` | Тип | Разрешения | Описание |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Шахматы** | `ommesh.chess` | `0x0100` | `p2p` | `peerData`, `storage`, `notifications` | P2P-шахматы по LoRa (MCRS v2): 1 AES-блок на ход, двусторонняя синхронизация, чат партии и фоновый воркер |
| **Шашки** | `ommesh.checkers` | `0x0101` | `p2p` | `peerData`, `storage`, `notifications` | Русские шашки 8×8 по LoRa с обязательным боем, летающими дамками, 1 AES-блок на ход и чатом партии |
| **Морской бой** | `ommesh.battleship` | `0x0102` | `p2p` | `peerData`, `storage`, `notifications` | Морской бой 10×10 по LoRa с автоответом в фоне, проверкой честности (SHA-256 commit-reveal) и чатом партии |
| **Калькулятор LoRa** | `ommesh.lora-calc` | `0x0000` | `standalone` | *(нет)* | Офлайн-расчёт эфирного времени LoRa и зоны Френеля |

## Быстрый старт

Требуется **Node.js 22+** (без внешних npm-зависимостей).

```sh
# Проверить все приложения, шаблоны и registry.json
npm run validate

# Запустить тесты мини-приложений
npm test

# Собрать готовые пакеты dist/*.omapp и dist/catalog.json
npm run build
```

Любой собранный файл `dist/<id>.omapp` можно сразу загрузить в Ommesh через **Приложения → Магазин → Загрузить .omapp** (для отладки без железа доступен **Деморежим**).

При каждом пуше в `master` GitHub Actions автоматически публикует `dist/catalog.json` (с SHA-256 хешами и SVG-иконками) и все `.omapp`-пакеты на GitHub Pages (`https://cm4ker.github.io/ommesh-miniapps/`), откуда Магазин Ommesh напрямую ставит новые мини-приложения и обновления без обновления основного приложения.

## Создать своё мини-приложение

```sh
# Автономная офлайн-утилита (appId = 0, без доступа к радио)
npm run new -- my-tool --standalone

# LoRa P2P-приложение (выделяет dev appId из 0xFF00..0xFFFF)
npm run new -- my-game --p2p --app-id 0xff10
```

Структура приложения в `apps/<slug>/`:

```text
apps/my-app/
├── manifest.json   # Манифест schema=1, appId, scope, permissions, backgroundNotices
├── icon.svg        # Монохромный SVG на currentColor (без <script>)
├── index.html      # Интерфейс (поддерживаются ./style.css, ./script.js и /* @include */)
├── worker.js       # Необязательный фоновый обработчик пакетов (self.onPacket)
└── test.mjs        # Необязательные unit-тесты на node:test
```

Команда `npm run build` автоматически встраивает локальные `./*.js`, `./*.css` и `/* @include ./file.js */` в единый автономный пакет `.omapp` (до 512 КБ).

## Диапазоны `appId`

| Диапазон | Назначение |
| :--- | :--- |
| `0x0000` | Автономные офлайн-утилиты (без радиообмена) |
| `0x0100..0xFEFF` | Официальный каталог P2P-приложений (регистрируются в `registry.json`) |
| `0xFF00..0xFFFF` | Локальная разработка и загрузка `.omapp` вручную |

## Как добавить приложение в каталог

1. Сделайте форк репозитория и добавьте приложение в `apps/<slug>/`.
2. Для P2P-приложения зарезервируйте свободный `appId` в `registry.json` (`0x0100..0xFEFF`).
3. Убедитесь, что приложение:
   - использует CSS-токены тем Ommesh (`var(--bg)`, `var(--panel)`, `var(--text)`, `var(--accent)`, …), учитывает мобильные отступы (`var(--safe-bottom)`) и выезд клавиатуры (`data-keyboard="open"`),
   - укладывается в лимит 512 КБ на `.omapp` и 150 Б на один LoRa-пакет,
   - проходит `npm run validate`, `npm test` и `npm run build`.
4. Откройте Pull Request с описанием приложения и (для P2P) бинарного протокола обмена.

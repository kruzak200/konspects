# Konspects

Локальная библиотека конспектов для macOS (Apple Silicon).  
Personal offline conspect library for macOS (Apple Silicon).

Сжимаете текст в **Merlin** сами → вставляете готовый конспект сюда → читаете офлайн и переписываете в тетрадь.  
Compress in **Merlin** yourself → paste the finished conspect here → read offline and hand-copy into a notebook.

**Без AI / без API-ключей.** Данные — обычные файлы в `Документы/Konspects` (`~/Documents/Konspects`).

```text
Документы/Konspects/
  Предмет А/
    Глава 1.md
    Глава 2.md
  Предмет Б/
    ...
```

## Требования / Requirements (Mac)

- macOS 12+ на Apple Silicon (M1–M4)
- [Node.js 20+](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/) 1.90+ (нужен для Tauri; в репозитории есть `rust-toolchain.toml` — `rustup` подхватит сам)
- Xcode Command Line Tools: `xcode-select --install`

## Установка и запуск / Install & run

В терминале:

```bash
git clone https://github.com/kruzak200/konspects.git
cd konspects
npm install
```

### Режим разработки / Dev

```bash
npm run tauri dev
```

Откроется окно приложения. UI на русском.

### Сборка .app / Build

```bash
npm run tauri build
```

Готовое приложение будет в:

`src-tauri/target/release/bundle/macos/Konspects.app`

(и `.dmg`, если сборка его создала)

Можно перетащить `Konspects.app` в «Программы».

### Только фронтенд в браузере (удобно проверить UI)

```bash
npm run dev
```

Откройте `http://localhost:1420`. В браузере данные живут в `localStorage` (это превью). На Mac через `tauri` всё пишется в `Документы/Konspects`.

## Как пользоваться / How to use

1. Создайте **предмет**
2. Внутри создайте **главу**
3. Вкладка **«Править»** — вставьте конспект из Merlin или правьте уже сохранённый:
   - заголовки (З1–З3) и абзацы
   - **жирный** / *курсив*
   - таблицы (кнопка «Таблица»; внутри таблицы — ряды и столбцы)
4. **Сохранить** — файл главы на диске (Markdown + GFM-таблицы)
5. Вкладка **«Читать»** — спокойный вид для переписывания в тетрадь
6. Можно закрыть приложение и открыть позже **без интернета**

## Стек / Stack

Tauri 2 · Vite · React · TypeScript

## Вне MVP / Out of scope

Поиск, синхронизация, iCloud, интеграция с Merlin, платные API, упаковка под Windows/Linux (сначала Mac).

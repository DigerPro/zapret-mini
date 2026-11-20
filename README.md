# Zapret Mini

**Zapret Mini — бесплатная открытая оболочка (GUI) для zapret.**

> **Единственный автор zapret, с которым работает этот проект, — Flowseal:**
> [github.com/Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube)  
> Zapret Mini не является автором zapret и не является официальным клиентом
> Flowseal. Это только графическая оболочка: окно, переключение стратегий,
> проверка сайтов и установка сборки.

Панель управления обходом блокировок для Windows на базе
[zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube).

Проект **полностью бесплатный**: нет платных версий, подписок и платного доступа.
Исходный код **открыт**: [DigerPro/zapret-mini](https://github.com/DigerPro/zapret-mini),
лицензия MIT.

![Главное окно](docs/preview.png)

## Возможности

- Перебор и применение стратегий zapret, группы ALT / FAKE TLS AUTO / SIMPLE FAKE.
- Проверка сайтов по категориям: Discord, YouTube, Instagram, Google, Cloudflare,
  Epic Games, DNS.
- «Тест всех» с итоговым рейтингом и кнопкой «Применить лучший».
- «Любой сайт…»: временно добавляет домен в пользовательский обход, перебирает
  стратегии, сохраняет рабочий вариант и показывает сайт отдельной карточкой.
- Встроенные сервисы защищены от отключения; добавленные сайты можно выключать
  свитчем и удалять.
- Если сборка zapret не найдена, приложение предлагает скачать официальную
  сборку Flowseal с GitHub и устанавливает её само.
- Автопроверка обновлений приложения через GitHub Releases.
- Автопроверка обновлений сборки zapret из
  [Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube):
  батники, `bin` и стандартные списки обновляются, пользовательские targets и
  списки сохраняются.
- Удаление через Windows «Параметры → Приложения» или через настройки приложения.

## Установка

1. Скачай `ZapretMini-<версия>-win-x64.zip` из
   [Releases](https://github.com/DigerPro/zapret-mini/releases).
2. Распакуй приложение, например, в
   `%LOCALAPPDATA%\Programs\ZapretMini` и запусти `ZapretMini.exe`.
3. Подтверди UAC. Если сборки zapret нет, приложение предложит скачать
   официальную сборку
   [Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube).
   Нажми «Скачать»: приложение само скачает последнюю версию с GitHub,
   установит её в `%LOCALAPPDATA%\ZapretMini\zapret` и применит стратегию.
4. Если сборка уже есть на диске, приложение найдёт её на рабочем столе,
   в загрузках или в `C:\zapret`. Если не нашло — укажи папку в настройках
   или нажми «Скачать» в разделе «Сборка zapret».
5. При первом запуске создаётся задача автозапуска без UAC.

Приложение не подписано сертификатом. SmartScreen может предупредить:
«Подробнее» → «Выполнить всё равно». `winws.exe` из zapret требует WinDivert и
может вызвать предупреждение антивируса — это часть zapret.

## Обновления

- **Приложение** проверяет `releases/latest` этого репозитория. Если версия новее,
  предлагает скачать и установить её. Настройки, список сайтов и папка zapret не
  затрагиваются.
- **Батники zapret** проверяются через GitHub API Flowseal. Обновление заменяет
  `bin`, `.bat` и стандартные списки, но сохраняет:
  - `utils\targets.txt` — пользовательские сайты и группы;
  - `lists\list-general-user.txt`;
  - `lists\list-exclude-user.txt`;
  - `lists\ipset-exclude-user.txt`;
  - дополнительные `.bat`-файлы пользователя.
- Оба обновления можно проверить вручную: «Настройки → Обновления».

## Удаление

- Windows: **Параметры → Приложения → Zapret Mini → Удалить**.
- Или в приложении: **Настройки → Удаление → Удалить**.

Удаляются приложение, настройки, список сайтов и управляемая папка zapret в
`%LOCALAPPDATA%\ZapretMini`. Папка zapret, выбранная вручную вне этой директории,
не удаляется.

## Сборка

```powershell
npm ci
npm test
npm run pack
```

Готовое приложение: `release\win-unpacked`.

## Авторство и лицензия

- **Zapret** — сторонний проект. Единственный автор сборки, с которой работает
  Zapret Mini, — **Flowseal**:
  [github.com/Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube).
- **Zapret Mini** — только оболочка. Автор оболочки не является автором zapret
  и не претендует на него.
- Проект **полностью бесплатный**: нет платных версий, подписок и платного
  доступа.
- Исходный код Zapret Mini **открыт** и распространяется по лицензии MIT:
  [github.com/DigerPro/zapret-mini](https://github.com/DigerPro/zapret-mini),
  [LICENSE](LICENSE).
- `winws.exe`, WinDivert и батники — сторонние компоненты. Они не входят в этот
  репозиторий и распространяются по своим лицензиям.

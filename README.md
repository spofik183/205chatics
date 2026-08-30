# 205chating v7

Обновление интерфейса чата, записи видео-квадрата, закреплений и панели администратора.

## v7
- Видео-квадрат: фон размывается, но квадрат и нижняя панель сообщения остаются чёткими.
- Оранжевый прогресс вокруг квадрата до 59 секунд, цифровой таймер убран.
- Сообщения шире и ниже.
- Панель ввода закреплена в layout и не уезжает при длинной истории.
- Закрепление отображается монохромным 📌.
- Панель администратора снова доступна из бокового меню и содержит управление галочками/админами, статусы и быстрый переход к настройкам 205chat.

## v8 — support, 🍓 and gifts

- Settings now include **Support**. For ordinary users, the “чат с ботом” thread appears only after opening Support and can later be hidden from the sidebar. Administrators always have access to the support inbox and can answer each user from the same chat UI.
- Added the **🍓 strawberry** balance. Admins can add or subtract any practical amount from the admin panel.
- Manual purchase requests: 100🍓 / 49₽, 300🍓 / 119₽, 750🍓 / 239₽. The bot shows payment instructions, the user marks a transfer as paid, and an admin approves or rejects it. No automatic bank/payment API is used.
- Added 9 starter gifts using the supplied artwork. Gifts are sent only in private chats, have a 50-character letter, store sender information and price, and can be featured beside the recipient username.

Important: the current JSON database and uploaded media still live on the server filesystem. On Railway this storage can be ephemeral across redeployments. For production payments and balances, migrate users, transactions, gifts and support tickets to a persistent database before accepting real payments.

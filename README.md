# 205chating v2

Realtime messenger on Node.js + Express + Socket.IO.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Railway

- Start command: `npm start`
- App binds to `0.0.0.0` and `process.env.PORT` automatically.
- Add an environment variable `JWT_SECRET` with a long random value.

## New in v2

- dark/light theme
- Russian/English UI
- profile + editable username
- avatar upload with review screen
- local account switcher / add another account
- photo and video messages
- voice messages through microphone
- responsive mobile layout
- redesigned restrained UI
- admin user list and verification management

## Password security

205chating stores only bcrypt password hashes. Plain-text passwords are never saved and are never shown in the admin panel.

## Storage warning

Uploads and `data/db.json` are stored on the local filesystem. Railway containers are not persistent storage, so for real users migrate users/messages to PostgreSQL and media to object storage (for example S3-compatible storage).
v2 deployed

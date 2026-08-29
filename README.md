# Torrent Proxy

Minimal torrent proxy allowing you to upload a `.torrent` file and download the files via HTTP.

## Requirements
- Node 16+

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the client:

- Open `client/index.html` in a browser (or serve it from a static server).
- Upload a `.torrent` file, wait for progress, then click a file link to download.

Notes:
- This is a minimal example for local use only. It does not handle cleanup, authentication, or production concerns.
- Multi-file torrents are exposed as individual downloads.
 
GCS Integration
---------------

To enable upload of completed files to Google Cloud Storage (GCS), set the `GCS_BUCKET` environment variable to your bucket name and ensure credentials are available via the `GOOGLE_APPLICATION_CREDENTIALS` environment variable (or attach a service account to the VM).

Example env before starting the server:

```bash
export GCS_BUCKET=your-bucket-name
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
npm start
```

The server will upload completed files to `gs://your-bucket-name/<infoHash>/...` and include signed download URLs (24h expiry) in the `/status/:infoHash` response. The frontend will use those signed URLs when available.

Docker / Local testing
----------------------

You can run the worker locally with Docker and `docker-compose`.

1. Copy `.env.example` to `.env` and fill values (or set env vars directly):

```bash
cp .env.example .env
# edit .env to set GCS_BUCKET and GOOGLE_APPLICATION_CREDENTIALS
```

2. Build and run with docker-compose:

```bash
docker-compose build
docker-compose up
```

The server will be available on `http://localhost:3000` and downloads persist under `./downloads`.

If you prefer not to use Docker, set the environment variables locally and run `npm install` then `npm start` as documented above.

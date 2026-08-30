const express = require('express');
const multer = require('multer');
const WebTorrent = require('webtorrent');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');

const app = express();
const upload = multer();
const client = new WebTorrent();

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// In-memory map: infoHash -> { torrent, filesSaved: [ {name, path} ], done }
const torrents = {};

// GCS setup - requires env var GCS_BUCKET and credentials via
// GOOGLE_APPLICATION_CREDENTIALS or VM service account
const GCS_BUCKET = process.env.GCS_BUCKET || null;
let storage = null;
if (GCS_BUCKET) {
  try {
    storage = new Storage();
    console.log('GCS enabled. Bucket:', GCS_BUCKET);
  } catch (e) {
    console.warn('Failed to initialize GCS client', e);
    storage = null;
  }
} else {
  console.log('GCS_BUCKET not set - GCS upload disabled');
}

app.post('/upload', upload.single('torrent'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No torrent file uploaded' });

  try {
    const torrentBuffer = req.file.buffer;
    const torrent = client.add(torrentBuffer, { path: DOWNLOADS_DIR });
    const infoHash = torrent.infoHash;

    torrents[infoHash] = { torrent, filesSaved: [], done: false };

    // Wait for metadata (file list) to be ready before responding
    torrent.on('ready', () => {
      // Stream each file to disk (webtorrent will also write to path if provided)
      torrent.files.forEach((file, idx) => {
        const outPath = path.join(DOWNLOADS_DIR, infoHash + '_' + idx + '_' + file.name.replace(/[/\\]/g, '_'));
        const writeStream = fs.createWriteStream(outPath);
        file.createReadStream().pipe(writeStream);
        torrents[infoHash].filesSaved.push({ name: file.name, path: outPath, index: idx, length: file.length });
      });

      res.json({ infoHash, name: torrent.name, files: torrents[infoHash].filesSaved });
    });

    // Handle torrent completion and upload to GCS when done
    torrent.on('done', () => {
      (async () => {
        try {
          if (storage && GCS_BUCKET) {
            for (const f of torrents[infoHash].filesSaved) {
              try {
                const localPath = f.path;
                const dest = `${infoHash}/${path.basename(localPath)}`;
                await storage.bucket(GCS_BUCKET).upload(localPath, { destination: dest });
                const fileHandle = storage.bucket(GCS_BUCKET).file(dest);
                const [signedUrl] = await fileHandle.getSignedUrl({ action: 'read', expires: Date.now() + 24 * 60 * 60 * 1000 });
                f.gcs = { destination: dest, signedUrl };
              } catch (e) {
                console.error('GCS upload error for file', f.path, e);
              }
            }
          }
        } catch (e) {
          console.error('Error in done handler', e);
        } finally {
          torrents[infoHash].done = true;
        }
      })();
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add torrent' });
  }
});

app.get('/status/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const entry = torrents[infoHash];
  if (!entry) return res.status(404).json({ error: 'Unknown torrent' });

  const torrent = entry.torrent;
  res.json({
    infoHash,
    name: torrent.name,
    progress: Math.round(torrent.progress * 10000) / 100, // percent with 2 decimals
    downloadSpeed: torrent.downloadSpeed,
    numPeers: torrent.numPeers,
    done: entry.done,
    files: entry.filesSaved.map(f => ({ name: f.name, index: f.index, length: f.length, signedUrl: f.gcs ? f.gcs.signedUrl : null }))
  });
});

app.get('/download/:infoHash/:fileIndex', (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const entry = torrents[infoHash];
  if (!entry) return res.status(404).send('Unknown torrent');

  const idx = parseInt(fileIndex, 10);
  const fileMeta = entry.filesSaved.find(f => f.index === idx);
  if (!fileMeta) return res.status(404).send('File not found');

  const torrent = entry.torrent;
  const file = torrent.files[idx];
  if (!file) return res.status(404).send('File missing in torrent object');
  // If we have a signed GCS URL, redirect to it to offload bandwidth
  if (fileMeta.gcs && fileMeta.gcs.signedUrl) {
    return res.redirect(fileMeta.gcs.signedUrl);
  }

  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file.name)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  const stream = file.createReadStream();
  stream.pipe(res);
});

app.get('/list', (req, res) => {
  const list = Object.keys(torrents).map(k => ({ infoHash: k, name: torrents[k].torrent.name }));
  res.json(list);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

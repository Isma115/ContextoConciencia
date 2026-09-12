const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Extensiones conocidas: sirven como fallback cuando el contenedor no lleva
// una cabecera reconocible (por ejemplo, algunos formatos propietarios).
const MEDIA_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff',
  tiff: 'image/tiff', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', ogv: 'video/ogg',
  mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', mpga: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav',
  oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/mp4',
  m4b: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm',
  wma: 'audio/x-ms-wma', aiff: 'audio/aiff', aif: 'audio/aiff', aifc: 'audio/aiff',
  au: 'audio/basic', snd: 'audio/basic', amr: 'audio/amr', '3gp': 'audio/3gpp',
  caf: 'audio/x-caf', mka: 'audio/x-matroska', mp2: 'audio/mpeg', mpa: 'audio/mpeg',
  ac3: 'audio/ac3', dts: 'audio/vnd.dts', eac3: 'audio/eac3', gsm: 'audio/gsm',
  ra: 'audio/x-realaudio', ram: 'audio/x-pn-realaudio', voc: 'audio/x-voc',
  ape: 'audio/x-ape', wv: 'audio/wavpack', tta: 'audio/x-tta', dsf: 'audio/x-dsf',
  dff: 'audio/x-dff', mid: 'audio/midi', midi: 'audio/midi', kar: 'audio/midi'
});

function extensionFor(fileName) {
  return path.extname(String(fileName || '')).toLowerCase().replace(/^\./, '');
}

function mimeForFileName(fileName) {
  return MEDIA_MIME_BY_EXTENSION[extensionFor(fileName)] || '';
}

function kindForMime(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  return 'file';
}

function startsWith(buffer, signature, offset = 0) {
  const expected = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'latin1');
  return buffer.length >= offset + expected.length && buffer.subarray(offset, offset + expected.length).equals(expected);
}

function ascii(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('ascii');
}

function detectMimeFromBuffer(buffer, fileName = '') {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const extensionMime = mimeForFileName(fileName);

  if (startsWith(input, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (startsWith(input, '\xff\xd8\xff')) return 'image/jpeg';
  if (startsWith(input, 'GIF87a') || startsWith(input, 'GIF89a')) return 'image/gif';
  if (startsWith(input, 'BM')) return 'image/bmp';
  if (startsWith(input, 'II*\x00') || startsWith(input, 'MM\x00*')) return 'image/tiff';
  if (ascii(input, 0, 4) === 'RIFF' && ascii(input, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(input, 4, 8) === 'ftypavif' || ascii(input, 4, 8) === 'ftypavis') return 'image/avif';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(input.subarray(0, 4096).toString('utf8'))) return 'image/svg+xml';

  if (ascii(input, 0, 4) === 'RIFF' && ascii(input, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(input, 0, 4) === 'RIFF' && ascii(input, 8, 4) === 'AVI ') return 'video/x-msvideo';
  if (startsWith(input, 'OggS')) {
    if (input.includes(Buffer.from('OpusHead')) || input.includes(Buffer.from('vorbis')) || input.includes(Buffer.from('Speex   '))) return 'audio/ogg';
    return extensionMime.startsWith('audio/') ? extensionMime : 'video/ogg';
  }
  if (startsWith(input, 'fLaC')) return 'audio/flac';
  if (startsWith(input, 'ID3') || (input.length >= 2 && input[0] === 0xff && (input[1] & 0xe0) === 0xe0 && (input[1] & 0x06) !== 0)) return 'audio/mpeg';
  if (startsWith(input, 'MThd')) return 'audio/midi';
  if (startsWith(input, 'FORM') && (ascii(input, 8, 4) === 'AIFF' || ascii(input, 8, 4) === 'AIFC')) return 'audio/aiff';
  if (startsWith(input, 'caff')) return 'audio/x-caf';
  if (startsWith(input, '#!AMR')) return 'audio/amr';
  if (startsWith(input, 'Creative Voice File')) return 'audio/x-voc';
  if (startsWith(input, 'MAC ')) return 'audio/x-ape';
  if (startsWith(input, 'wvpk')) return 'audio/wavpack';
  if (startsWith(input, 'DSD ')) return 'audio/x-dsf';
  if (startsWith(input, 'FRM8')) return 'audio/x-dff';
  if (startsWith(input, '.snd')) return 'audio/basic';
  if (startsWith(input, '\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9\x00\xaa\x00\x62\xce\x6c')) return 'audio/x-ms-wma';
  if (startsWith(input, '\x0b\x77')) return extensionMime === 'audio/eac3' ? 'audio/eac3' : 'audio/ac3';
  if (startsWith(input, '\x7f\xfe\x80\x01') || startsWith(input, '\x1f\xff\xe8')) return 'audio/vnd.dts';

  if (startsWith(input, '%PDF-')) return 'application/pdf';
  if (startsWith(input, 'PK\x03\x04')) return 'application/zip';
  if (startsWith(input, '\x1f\x8b')) return 'application/gzip';

  if (ascii(input, 4, 4) === 'ftyp') {
    const brand = ascii(input, 8, 4);
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand === 'M4A ' || brand === 'M4B ' || extensionMime.startsWith('audio/')) return extensionMime || 'audio/mp4';
    if (brand.startsWith('3gp') && extensionMime.startsWith('audio/')) return extensionMime;
    return extensionMime || 'video/mp4';
  }

  return extensionMime || 'application/octet-stream';
}

function readHeader(filePath, maxBytes = 64 * 1024) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(descriptor, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* el archivo puede haberse cerrado al fallar la lectura */ }
    }
  }
}

function detectFileType(filePath, { fileName = filePath } = {}) {
  const header = readHeader(filePath);
  const extensionMime = mimeForFileName(fileName);
  const mime = detectMimeFromBuffer(header, fileName);
  return {
    mime,
    kind: kindForMime(mime),
    detectedBy: header.length ? (mime !== extensionMime ? 'content' : 'content-or-extension') : 'extension',
    extension: extensionFor(fileName)
  };
}

function resolveProbeExecutable() {
  const configured = String(process.env.NEXUSDATA_FFPROBE_PATH || process.env.FFPROBE_PATH || '').trim();
  const candidates = [configured];
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(path.join(root, 'FFmpeg', 'bin', 'ffprobe.exe'));
      candidates.push(path.join(root, 'FFmepg', 'bin', 'ffprobe.exe'));
    }
  }
  candidates.push('ffprobe');
  return candidates.find((candidate) => candidate && (candidate === 'ffprobe' || fs.existsSync(candidate))) || 'ffprobe';
}

function mimeForProbedCodec(codec, fileName) {
  const extensionMime = mimeForFileName(fileName);
  if (extensionMime.startsWith('audio/')) return extensionMime;
  const byCodec = {
    aac: 'audio/aac', ac3: 'audio/ac3', alac: 'audio/mp4',
    flac: 'audio/flac', mp2: 'audio/mpeg', mp3: 'audio/mpeg',
    opus: 'audio/ogg', pcm_s16le: 'audio/wav', pcm_s24le: 'audio/wav',
    vorbis: 'audio/ogg', wavpack: 'audio/wavpack', wmalossless: 'audio/x-ms-wma',
    wmav1: 'audio/x-ms-wma', wmav2: 'audio/x-ms-wma'
  };
  return byCodec[String(codec || '').toLowerCase()] || 'audio/octet-stream';
}

function probeFile(filePath, { fileName = filePath, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(resolveProbeExecutable(), [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', filePath
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    let timeout;
    const finish = (result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    timeout = setTimeout(() => {
      try { child.kill(); } catch { /* el proceso puede haber terminado */ }
      finish();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-16000); });
    child.on('error', () => finish());
    child.on('close', (code) => {
      if (code !== 0) return finish();
      try {
        const stream = JSON.parse(output).streams?.[0];
        if (stream?.codec_type !== 'audio') return finish();
        const mime = mimeForProbedCodec(stream.codec_name, fileName);
        return finish({ mime, kind: 'audio', codec: stream.codec_name || '', detectedBy: 'ffprobe' });
      } catch {
        return finish();
      }
    });
  });
}

module.exports = {
  MEDIA_MIME_BY_EXTENSION,
  detectFileType,
  detectMimeFromBuffer,
  kindForMime,
  mimeForFileName,
  probeFile
};

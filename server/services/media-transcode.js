const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function resolveFfmpegExecutable() {
  const configured = String(process.env.NEXUSDATA_FFMPEG_PATH || process.env.FFMPEG_PATH || '').trim();
  const candidates = [configured];
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(path.join(root, 'FFmpeg', 'bin', 'ffmpeg.exe'));
      candidates.push(path.join(root, 'FFmepg', 'bin', 'ffmpeg.exe'));
    }
  }
  candidates.push('ffmpeg');
  return candidates.find((candidate) => candidate && (candidate === 'ffmpeg' || fs.existsSync(candidate))) || 'ffmpeg';
}

function transcodeAudioToMp3(req, res, filePath) {
  const ffmpeg = resolveFfmpegExecutable();
  const processHandle = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let wroteHeaders = false;
  let failedToStart = false;
  const sendError = (status, message) => {
    if (res.headersSent) return res.destroy();
    return res.status(status).json({ error: message });
  };
  processHandle.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  processHandle.stdout.on('data', (chunk) => {
    if (!wroteHeaders) {
      wroteHeaders = true;
      res.status(200);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'no-store');
      res.set('Content-Disposition', 'inline; filename="recurso-convertido.mp3"');
    }
    if (!res.write(chunk)) processHandle.stdout.pause();
  });
  res.on('drain', () => processHandle.stdout.resume());
  processHandle.on('error', () => {
    failedToStart = true;
    sendError(501, 'FFmpeg no está disponible para convertir este audio. Puedes abrirlo con la aplicación predeterminada del sistema.');
  });
  processHandle.on('close', (code) => {
    if (failedToStart) return;
    if (code !== 0 && !wroteHeaders) return sendError(422, `FFmpeg no pudo convertir el audio${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    if (!res.writableEnded) res.end();
  });
  res.on('close', () => {
    if (!res.writableEnded && !processHandle.killed) processHandle.kill();
  });
  return processHandle;
}

module.exports = { resolveFfmpegExecutable, transcodeAudioToMp3 };

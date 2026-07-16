const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const COOKIE_NAME = 'nexusdata_session';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const OFFLINE_USER = { id: null, username: 'Modo offline', offline: true };

function sessionDuration(environment = process.env) { return environment.SESSION_DURATION || '8h'; }
function sessionMilliseconds(duration = sessionDuration()) {
  const match = /^(\d+)\s*([smhd])$/i.exec(String(duration));
  if (!match) return 8 * 60 * 60 * 1000;
  return Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()]);
}
function jwtSecret(environment = process.env) {
  if (!environment.JWT_SECRET || environment.JWT_SECRET.length < 32) throw new Error('La configuración de sesión no está disponible');
  return environment.JWT_SECRET;
}
function normalizeUsername(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validateCredentials(body = {}) {
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USERNAME_RE.test(username)) return { error: 'El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o guion bajo).' };
  if (password.length < 8 || password.length > 32) return { error: 'La contraseña debe tener entre 8 y 32 caracteres.' };
  return { username, password };
}
function publicUser(user) {
  return { id: Number(user.id), username: user.usuario, createdAt: new Date(user.creado_en).toISOString() };
}
function cookieOptions(environment = process.env) {
  return { httpOnly: true, sameSite: 'strict', secure: environment.NODE_ENV === 'production', maxAge: sessionMilliseconds(sessionDuration(environment)), path: '/' };
}
function issueSession(res, user, environment = process.env) {
  const token = jwt.sign({ sub: String(user.id), username: user.usuario }, jwtSecret(environment), { expiresIn: sessionDuration(environment) });
  res.cookie(COOKIE_NAME, token, cookieOptions(environment));
}
function issueOfflineSession(res, environment = process.env) {
  const token = jwt.sign({ sub: 'offline', offline: true }, jwtSecret(environment), { expiresIn: sessionDuration(environment) });
  res.cookie(COOKIE_NAME, token, cookieOptions(environment));
}
function loginLimiter() {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' } });
}
function requireAuth(authDb, environment = process.env) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) return res.status(401).json({ error: 'Sesión no válida.' });
      const session = jwt.verify(token, jwtSecret(environment));
      if (session.offline === true) {
        req.user = { ...OFFLINE_USER };
        return next();
      }
      if (!await authDb.ensureAvailable()) return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' });
      req.user = { id: session.sub, username: session.username };
      return next();
    } catch { return res.status(401).json({ error: 'Sesión no válida.' }); }
  };
}
function installAuthRoutes(app, authDb, environment = process.env) {
  app.post('/api/auth/offline', (req, res) => {
    try {
      issueOfflineSession(res, environment);
      return res.json({ user: { ...OFFLINE_USER } });
    } catch {
      return res.status(503).json({ error: 'El modo offline no está disponible.' });
    }
  });
  app.post('/api/auth/register', loginLimiter(), async (req, res) => {
    const credentials = validateCredentials(req.body);
    if (credentials.error) return res.status(400).json({ error: credentials.error });
    if (!await authDb.ensureAvailable()) return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' });
    try {
      const user = await authDb.createUser(credentials.username, await bcrypt.hash(credentials.password, 12));
      issueSession(res, user, environment);
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
      return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' });
    }
  });
  app.post('/api/auth/login', loginLimiter(), async (req, res) => {
    const credentials = validateCredentials(req.body);
    if (credentials.error) return res.status(400).json({ error: credentials.error });
    if (!await authDb.ensureAvailable()) return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' });
    try {
      const user = await authDb.findUserByUsername(credentials.username);
      if (!user || !await bcrypt.compare(credentials.password, user.password_hash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      issueSession(res, user, environment);
      return res.json({ user: publicUser(user) });
    } catch { return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' }); }
  });
  app.get('/api/auth/me', requireAuth(authDb, environment), async (req, res) => {
    if (req.user.offline) return res.json({ user: { ...OFFLINE_USER } });
    try {
      const user = await authDb.findUserByUsername(req.user.username);
      if (!user) return res.status(401).json({ error: 'Sesión no válida.' });
      return res.json({ user: publicUser(user) });
    } catch { return res.status(503).json({ error: 'El servicio de autenticación no está disponible.' }); }
  });
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: environment.NODE_ENV === 'production', path: '/' });
    res.status(204).end();
  });
}

module.exports = { COOKIE_NAME, OFFLINE_USER, installAuthRoutes, requireAuth, publicUser, normalizeUsername, validateCredentials };

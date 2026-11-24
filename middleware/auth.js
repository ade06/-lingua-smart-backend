const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production_env';

async function verifyJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ ok: false, message: 'Token autentikasi tidak ditemukan.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await db.query(
      'SELECT id, full_name, email, role, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ ok: false, message: 'Akun tidak ditemukan atau tidak aktif.' });
    }

    req.user = rows[0];
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: 'Token tidak valid atau sudah kedaluwarsa.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        message: 'Akses ditolak: Anda tidak memiliki otorisasi untuk resource ini.'
      });
    }
    return next();
  };
}

module.exports = { verifyJWT, requireRole, JWT_SECRET };

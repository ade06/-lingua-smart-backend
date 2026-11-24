require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { verifyJWT, requireRole, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function logAdminAction(adminId, action, targetType, targetId, details = {}) {
  await db.query(
    `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [adminId, action, targetType, String(targetId), JSON.stringify(details)]
  );
}

// ==================== HEALTHCHECK ====================
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, service: 'LINGUA SMART API', stage: 3, status: 'healthy' });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Koneksi database bermasalah.' });
  }
});

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      fullName,
      email,
      password,
      targetLanguageCode = 'en',
      proficiencyLevel = 'Pemula',
      dailyXpGoal = 50,
      avatar = '🦉'
    } = req.body;

    if (!fullName || !email || !password || String(password).length < 6) {
      return res.status(400).json({
        ok: false,
        message: 'Nama lengkap, email, dan password (minimal 6 karakter) wajib diisi.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, message: 'Email sudah terdaftar.' });
    }

    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(String(password), 10);

    const userInsert = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, avatar, target_language_code, proficiency_level, daily_xp_goal)
       VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)
       RETURNING id, full_name, email, role, avatar, target_language_code, proficiency_level, daily_xp_goal, created_at`,
      [
        String(fullName).trim(),
        normalizedEmail,
        passwordHash,
        avatar,
        targetLanguageCode,
        proficiencyLevel,
        Number(dailyXpGoal) || 50
      ]
    );

    const user = userInsert.rows[0];
    await client.query('INSERT INTO user_progress (user_id) VALUES ($1)', [user.id]);
    await client.query('COMMIT');

    const token = signToken(user);
    return res.status(201).json({
      ok: true,
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        targetLanguageCode: user.target_language_code,
        proficiencyLevel: user.proficiency_level,
        dailyXpGoal: user.daily_xp_goal
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal mendaftarkan akun.' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, message: 'Email dan password wajib diisi.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { rows } = await db.query(
      `SELECT id, full_name, email, password_hash, role, avatar, target_language_code, proficiency_level, daily_xp_goal, is_active
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, message: 'Email atau password salah.' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ ok: false, message: 'Akun Anda sedang dinonaktifkan.' });
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, message: 'Email atau password salah.' });
    }

    const token = signToken(user);
    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        targetLanguageCode: user.target_language_code,
        proficiencyLevel: user.proficiency_level,
        dailyXpGoal: user.daily_xp_goal
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, message: 'Terjadi kesalahan saat login.' });
  }
});

app.get('/api/auth/me', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.avatar, u.target_language_code, u.proficiency_level, u.daily_xp_goal,
              p.xp, p.gems, p.hearts, p.streak_days, p.best_streak, p.streak_freeze, p.last_active_date,
              p.completed_lessons, p.vocabulary_count, p.quest_state
       FROM users u
       LEFT JOIN user_progress p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    const row = rows[0];
    return res.json({
      ok: true,
      user: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        avatar: row.avatar,
        targetLanguageCode: row.target_language_code,
        proficiencyLevel: row.proficiency_level,
        dailyXpGoal: row.daily_xp_goal
      },
      progress: {
        xp: row.xp ?? 0,
        gems: row.gems ?? 50,
        hearts: row.hearts ?? 5,
        streakDays: row.streak_days ?? 0,
        bestStreak: row.best_streak ?? 0,
        streakFreeze: row.streak_freeze ?? 1,
        lastActiveDate: row.last_active_date,
        completedLessons: row.completed_lessons ?? [],
        vocabularyCount: row.vocabulary_count ?? 0,
        questState: row.quest_state ?? {}
      }
    });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal memuat profil pengguna.' });
  }
});

// ==================== PROGRESS SYNC & XP LOGGING ====================
app.put('/api/progress/sync', verifyJWT, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      xp,
      gems,
      hearts,
      streakDays,
      bestStreak,
      streakFreeze,
      completedLessons,
      vocabularyCount,
      questState,
      targetLanguageCode,
      proficiencyLevel,
      dailyXpGoal,
      avatar,
      fullName
    } = req.body;

    await client.query('BEGIN');

    if (targetLanguageCode || proficiencyLevel || dailyXpGoal || avatar || fullName) {
      await client.query(
        `UPDATE users SET
           target_language_code = COALESCE($2, target_language_code),
           proficiency_level = COALESCE($3, proficiency_level),
           daily_xp_goal = COALESCE($4, daily_xp_goal),
           avatar = COALESCE($5, avatar),
           full_name = COALESCE($6, full_name),
           updated_at = NOW()
         WHERE id = $1`,
        [
          req.user.id,
          targetLanguageCode || null,
          proficiencyLevel || null,
          dailyXpGoal ? Number(dailyXpGoal) : null,
          avatar || null,
          fullName ? String(fullName).trim() : null
        ]
      );
    }

    const prevRes = await client.query('SELECT xp FROM user_progress WHERE user_id = $1', [req.user.id]);
    const prevXp = prevRes.rows[0]?.xp ?? 0;
    const safeXp = Math.max(0, Number(xp ?? prevXp));
    const delta = safeXp - prevXp;

    if (delta > 500) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, message: 'Perubahan XP melebihi batas validasi server.' });
    }

    const updated = await client.query(
      `UPDATE user_progress SET
         xp = $2,
         gems = GREATEST(0, $3),
         hearts = GREATEST(0, LEAST(5, $4)),
         streak_days = GREATEST(0, $5),
         best_streak = GREATEST(best_streak, $6),
         streak_freeze = GREATEST(0, $7),
         last_active_date = CURRENT_DATE,
         completed_lessons = COALESCE($8::jsonb, completed_lessons),
         vocabulary_count = GREATEST(0, $9),
         quest_state = COALESCE($10::jsonb, quest_state),
         updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [
        req.user.id,
        safeXp,
        Number(gems ?? 50),
        Number(hearts ?? 5),
        Number(streakDays ?? 0),
        Number(bestStreak ?? streakDays ?? 0),
        Number(streakFreeze ?? 1),
        completedLessons ? JSON.stringify(completedLessons) : null,
        Number(vocabularyCount ?? 0),
        questState ? JSON.stringify(questState) : null
      ]
    );

    if (delta > 0) {
      await client.query(
        `INSERT INTO xp_logs (user_id, xp_delta, source, metadata)
         VALUES ($1, $2, 'progress_sync', $3::jsonb)`,
        [req.user.id, delta, JSON.stringify({ newXp: safeXp })]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true, progress: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sync progress error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal menyinkronkan progres.' });
  } finally {
    client.release();
  }
});

// ==================== ONLINE LEADERBOARD ====================
app.get('/api/leaderboard', async (req, res) => {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'weekly';

    let queryText = '';
    if (period === 'daily') {
      queryText = `
        SELECT u.id, u.full_name, u.avatar, u.target_language_code,
               COALESCE(SUM(l.xp_delta), 0)::int AS period_xp,
               COALESCE(p.xp, 0)::int AS total_xp,
               COALESCE(p.streak_days, 0)::int AS streak_days
        FROM users u
        LEFT JOIN user_progress p ON p.user_id = u.id
        LEFT JOIN xp_logs l ON l.user_id = u.id AND l.created_at >= date_trunc('day', NOW())
        WHERE u.is_active = TRUE AND u.role = 'user'
        GROUP BY u.id, u.full_name, u.avatar, u.target_language_code, p.xp, p.streak_days
        ORDER BY period_xp DESC, total_xp DESC
        LIMIT 25
      `;
    } else if (period === 'weekly') {
      queryText = `
        SELECT u.id, u.full_name, u.avatar, u.target_language_code,
               COALESCE(SUM(l.xp_delta), 0)::int AS period_xp,
               COALESCE(p.xp, 0)::int AS total_xp,
               COALESCE(p.streak_days, 0)::int AS streak_days
        FROM users u
        LEFT JOIN user_progress p ON p.user_id = u.id
        LEFT JOIN xp_logs l ON l.user_id = u.id AND l.created_at >= NOW() - INTERVAL '7 days'
        WHERE u.is_active = TRUE AND u.role = 'user'
        GROUP BY u.id, u.full_name, u.avatar, u.target_language_code, p.xp, p.streak_days
        ORDER BY period_xp DESC, total_xp DESC
        LIMIT 25
      `;
    } else {
      queryText = `
        SELECT u.id, u.full_name, u.avatar, u.target_language_code,
               COALESCE(SUM(l.xp_delta), 0)::int AS period_xp,
               COALESCE(p.xp, 0)::int AS total_xp,
               COALESCE(p.streak_days, 0)::int AS streak_days
        FROM users u
        LEFT JOIN user_progress p ON p.user_id = u.id
        LEFT JOIN xp_logs l ON l.user_id = u.id AND l.created_at >= NOW() - INTERVAL '30 days'
        WHERE u.is_active = TRUE AND u.role = 'user'
        GROUP BY u.id, u.full_name, u.avatar, u.target_language_code, p.xp, p.streak_days
        ORDER BY period_xp DESC, total_xp DESC
        LIMIT 25
      `;
    }

    const { rows } = await db.query(queryText);
    const ranked = rows.map((r, idx) => ({
      rank: idx + 1,
      id: r.id,
      name: r.full_name,
      avatar: r.avatar,
      languageCode: r.target_language_code,
      xp: r.period_xp > 0 ? r.period_xp : r.total_xp,
      totalXp: r.total_xp,
      streakDays: r.streak_days
    }));

    return res.json({ ok: true, period, leaderboard: ranked });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal memuat leaderboard.' });
  }
});

// ==================== PUBLIC CONTENT & ADS ROUTES ====================
app.get('/api/content/bootstrap', async (req, res) => {
  try {
    const [langs, units, lessons, questions, articles, ads, pages] = await Promise.all([
      db.query('SELECT * FROM languages WHERE is_active = TRUE ORDER BY sort_order ASC, name ASC'),
      db.query('SELECT * FROM units WHERE is_published = TRUE ORDER BY sort_order ASC, id ASC'),
      db.query('SELECT * FROM lessons WHERE is_published = TRUE ORDER BY sort_order ASC, id ASC'),
      db.query('SELECT * FROM questions ORDER BY sort_order ASC, id ASC'),
      db.query('SELECT * FROM articles WHERE is_published = TRUE ORDER BY published_at DESC'),
      db.query('SELECT * FROM ad_configs ORDER BY slot_key ASC'),
      db.query('SELECT * FROM static_pages ORDER BY slug ASC')
    ]);

    return res.json({
      ok: true,
      languages: langs.rows,
      units: units.rows,
      lessons: lessons.rows,
      questions: questions.rows,
      articles: articles.rows,
      adConfigs: ads.rows,
      pages: pages.rows
    });
  } catch (err) {
    console.error('Bootstrap error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal memuat konten aplikasi.' });
  }
});

// ==================== ADMIN DASHBOARD ROUTES (PROTECTED BY SERVER) ====================
app.get('/api/admin/overview', verifyJWT, requireRole('admin'), async (req, res) => {
  try {
    const [
      usersStats,
      activeToday,
      articlesCount,
      lessonsCount,
      questionsCount,
      recentUsers,
      auditLogs
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total_users,
                       COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_users
                FROM users WHERE role = 'user'`),
      db.query(`SELECT COUNT(DISTINCT user_id)::int AS active_today
                FROM xp_logs WHERE created_at >= date_trunc('day', NOW())`),
      db.query('SELECT COUNT(*)::int AS total_articles FROM articles'),
      db.query('SELECT COUNT(*)::int AS total_lessons FROM lessons'),
      db.query('SELECT COUNT(*)::int AS total_questions FROM questions'),
      db.query(`SELECT u.id, u.full_name, u.email, u.role, u.avatar, u.target_language_code,
                       u.is_active, u.created_at, COALESCE(p.xp, 0)::int AS xp, COALESCE(p.streak_days, 0)::int AS streak_days
                FROM users u
                LEFT JOIN user_progress p ON p.user_id = u.id
                ORDER BY u.created_at DESC
                LIMIT 50`),
      db.query(`SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at, u.full_name AS admin_name
                FROM admin_audit_logs a
                LEFT JOIN users u ON u.id = a.admin_id
                ORDER BY a.created_at DESC
                LIMIT 25`)
    ]);

    return res.json({
      ok: true,
      stats: {
        totalUsers: usersStats.rows[0]?.total_users ?? 0,
        activeUsers: usersStats.rows[0]?.active_users ?? 0,
        activeToday: activeToday.rows[0]?.active_today ?? 0,
        totalArticles: articlesCount.rows[0]?.total_articles ?? 0,
        totalLessons: lessonsCount.rows[0]?.total_lessons ?? 0,
        totalQuestions: questionsCount.rows[0]?.total_questions ?? 0
      },
      users: recentUsers.rows,
      auditLogs: auditLogs.rows
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal memuat data dashboard admin.' });
  }
});

app.post('/api/admin/articles', verifyJWT, requireRole('admin'), async (req, res) => {
  try {
    const { title, slug, category, metaDescription, excerpt, contentMarkdown, sampleSentences = [], faqs = [], isPublished = true } = req.body;
    if (!title || !category || !contentMarkdown) {
      return res.status(400).json({ ok: false, message: 'Judul, kategori, dan isi artikel wajib diisi.' });
    }

    const finalSlug = (slug || title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now().toString().slice(-4);

    const { rows } = await db.query(
      `INSERT INTO articles (slug, title, category, meta_description, excerpt, content_markdown, sample_sentences, faqs, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       RETURNING *`,
      [
        finalSlug,
        String(title).trim(),
        String(category).trim(),
        String(metaDescription || excerpt || title).slice(0, 240),
        String(excerpt || contentMarkdown).slice(0, 300),
        String(contentMarkdown),
        JSON.stringify(sampleSentences),
        JSON.stringify(faqs),
        Boolean(isPublished)
      ]
    );

    await logAdminAction(req.user.id, 'CREATE_ARTICLE', 'article', rows[0].id, { title: rows[0].title });
    return res.status(201).json({ ok: true, article: rows[0] });
  } catch (err) {
    console.error('Create article error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal menambah artikel.' });
  }
});

app.put('/api/admin/articles/:id', verifyJWT, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, metaDescription, excerpt, contentMarkdown, isPublished } = req.body;

    const { rows } = await db.query(
      `UPDATE articles SET
         title = COALESCE($2, title),
         category = COALESCE($3, category),
         meta_description = COALESCE($4, meta_description),
         excerpt = COALESCE($5, excerpt),
         content_markdown = COALESCE($6, content_markdown),
         is_published = COALESCE($7, is_published),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, title, category, metaDescription, excerpt, contentMarkdown, isPublished]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'Artikel tidak ditemukan.' });
    }

    await logAdminAction(req.user.id, 'UPDATE_ARTICLE', 'article', id, { title: rows[0].title });
    return res.json({ ok: true, article: rows[0] });
  } catch (err) {
    console.error('Update article error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal memperbarui artikel.' });
  }
});

app.delete('/api/admin/articles/:id', verifyJWT, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query('DELETE FROM articles WHERE id = $1 RETURNING id, title', [id]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'Artikel tidak ditemukan.' });
    }
    await logAdminAction(req.user.id, 'DELETE_ARTICLE', 'article', id, { title: rows[0].title });
    return res.json({ ok: true, deletedId: rows[0].id });
  } catch (err) {
    console.error('Delete article error:', err);
    return res.status(500).json({ ok: false, message: 'Gagal menghapus artikel.' });
  }
});

app.post('/api/admin/lessons', verifyJWT, requireRole('admin'), async (req, res) => {
  try {
    const { id, unitId, title, topic, xpReward = 20, sortOrder = 1 } = req.body;
    if (!unitId || !title || !topic) {
      return res.status(400).json({ ok: false, message: 'Unit ID, judul pelajaran, dan topik wajib dii

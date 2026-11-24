-- Skema Database LINGUA SMART (Tahap 3)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar VARCHAR(32) NOT NULL DEFAULT '🦉',
  target_language_code VARCHAR(16) NOT NULL DEFAULT 'en',
  proficiency_level VARCHAR(24) NOT NULL DEFAULT 'Pemula',
  daily_xp_goal INT NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_progress (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp INT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  gems INT NOT NULL DEFAULT 50 CHECK (gems >= 0),
  hearts INT NOT NULL DEFAULT 5 CHECK (hearts >= 0 AND hearts <= 5),
  streak_days INT NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  best_streak INT NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  streak_freeze INT NOT NULL DEFAULT 1 CHECK (streak_freeze >= 0),
  last_active_date DATE,
  completed_lessons JSONB NOT NULL DEFAULT '[]'::jsonb,
  vocabulary_count INT NOT NULL DEFAULT 0 CHECK (vocabulary_count >= 0),
  quest_state JSONB NOT NULL DEFAULT '{"lessonsDone":0,"xpEarnedToday":0,"questionsAnswered":0,"minutesStudied":0,"claimed":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE xp_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  xp_delta INT NOT NULL,
  source VARCHAR(60) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE languages (
  code VARCHAR(16) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  native_name VARCHAR(80) NOT NULL,
  flag VARCHAR(16) NOT NULL,
  tts_lang VARCHAR(16) NOT NULL DEFAULT 'en-US',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE units (
  id SERIAL PRIMARY KEY,
  language_code VARCHAR(16) NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  title VARCHAR(140) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE lessons (
  id VARCHAR(64) PRIMARY KEY,
  unit_id INT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title VARCHAR(140) NOT NULL,
  topic VARCHAR(120) NOT NULL,
  xp_reward INT NOT NULL DEFAULT 20,
  sort_order INT NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE questions (
  id VARCHAR(64) PRIMARY KEY,
  lesson_id VARCHAR(64) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  q_type VARCHAR(32) NOT NULL,
  prompt TEXT NOT NULL,
  audio_text TEXT DEFAULT '',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer JSONB NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 1
);

CREATE TABLE articles (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(180) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  meta_description VARCHAR(240) NOT NULL,
  excerpt TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  sample_sentences JSONB NOT NULL DEFAULT '[]'::jsonb,
  faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ad_configs (
  slot_key VARCHAR(64) PRIMARY KEY,
  page_name VARCHAR(80) NOT NULL,
  placement_label VARCHAR(140) NOT NULL,
  ad_unit_id VARCHAR(120) NOT NULL DEFAULT '',
  ad_format VARCHAR(40) NOT NULL DEFAULT 'auto',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE static_pages (
  slug VARCHAR(64) PRIMARY KEY,
  title VARCHAR(140) NOT NULL,
  content_html TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id VARCHAR(120) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_xp_logs_user_created ON xp_logs(user_id, created_at DESC);
CREATE INDEX idx_xp_logs_created ON xp_logs(created_at DESC);
CREATE INDEX idx_lessons_unit_order ON lessons(unit_id, sort_order);
CREATE INDEX idx_questions_lesson_order ON questions(lesson_id, sort_order);
CREATE INDEX idx_articles_category_pub ON articles(category, is_published, published_at DESC);

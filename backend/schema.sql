-- Mihomo Platform D1 Schema

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  api_token     TEXT    NOT NULL UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS proxies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  server     TEXT    NOT NULL,
  port       INTEGER NOT NULL,
  config     TEXT    NOT NULL,
  -- 链式代理的前置节点名称；普通节点为 NULL。值对应同一用户的 proxies.name。
  dialer_proxy TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_proxies_user ON proxies(user_id);

CREATE TABLE IF NOT EXISTS paid_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paid_subs_user ON paid_subscriptions(user_id);

-- 付费订阅的包装地址 token。源地址只保存在 paid_subscriptions.url，
-- 对外只暴露 /subscribes?token=<wrapper_token>，避免源地址出现在配置与前端。
CREATE TABLE IF NOT EXISTS paid_sub_wrappers (
  paid_subscription_id INTEGER PRIMARY KEY REFERENCES paid_subscriptions(id) ON DELETE CASCADE,
  token                 TEXT    NOT NULL UNIQUE,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paid_sub_wrappers_token ON paid_sub_wrappers(token);

CREATE TABLE IF NOT EXISTS templates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL DEFAULT 0,
  name                 TEXT    NOT NULL,
  is_system            INTEGER NOT NULL DEFAULT 0,
  dns_mode             TEXT    NOT NULL DEFAULT 'fake-ip',
  ad_blocking          INTEGER NOT NULL DEFAULT 1,
  regions              TEXT    NOT NULL DEFAULT '[]',
  include_custom_rules INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);

-- 每用户一份共享自定义规则，JSON 数组并保持顺序；模板只保存是否加入。
CREATE TABLE IF NOT EXISTS user_custom_rules (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rules      TEXT    NOT NULL DEFAULT '[]',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT    NOT NULL,
  profile_token       TEXT    NOT NULL UNIQUE,
  template_id         INTEGER NOT NULL REFERENCES templates(id),
  enabled             INTEGER NOT NULL DEFAULT 1,
  include_private_sub INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_token ON profiles(profile_token);

CREATE TABLE IF NOT EXISTS profile_paid_subs (
  profile_id         INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paid_subscription_id INTEGER NOT NULL REFERENCES paid_subscriptions(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, paid_subscription_id)
);

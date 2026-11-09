-- System templates (user_id = 0, is_system = 1)

INSERT OR IGNORE INTO templates (user_id, name, is_system, dns_mode, ad_blocking, regions, include_custom_rules)
VALUES
  (0, 'Fake-IP (去广告)',    1, 'fake-ip',  1, '[]', 1),
  (0, 'Fake-IP (不去广告)',  1, 'fake-ip',  0, '[]', 1),
  (0, 'Real-IP (去广告)',    1, 'real-ip',  1, '[]', 1),
  (0, 'Real-IP (不去广告)',  1, 'real-ip',  0, '[]', 1);

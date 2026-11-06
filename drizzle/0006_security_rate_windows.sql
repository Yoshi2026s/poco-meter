CREATE TABLE IF NOT EXISTS `security_rate_windows` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `hits` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_security_rate_expiry` ON `security_rate_windows` (`expires_at`);

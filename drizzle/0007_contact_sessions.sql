CREATE TABLE `contact_sessions` (
  `visitor_hash` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer
);

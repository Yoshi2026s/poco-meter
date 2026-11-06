CREATE TABLE `site_visit_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_site_visit_events_day_visitor` ON `site_visit_events` (`day`,`visitor_hash`);
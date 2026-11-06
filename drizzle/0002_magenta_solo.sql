ALTER TABLE `site_visit_events` ADD `occurred_at` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `country` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `region` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `city` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `device_type` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `device_model` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `os_family` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `os_version` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `browser_family` text;--> statement-breakpoint
ALTER TABLE `site_visit_events` ADD `browser_version` text;--> statement-breakpoint
CREATE INDEX `idx_site_visit_events_day_time` ON `site_visit_events` (`day`,`occurred_at`);
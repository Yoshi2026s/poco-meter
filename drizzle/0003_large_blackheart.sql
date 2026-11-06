CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `contact_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contact_messages_thread_time` ON `contact_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_hash` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contact_threads_visitor_updated` ON `contact_threads` (`visitor_hash`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_contact_threads_updated` ON `contact_threads` (`updated_at`);
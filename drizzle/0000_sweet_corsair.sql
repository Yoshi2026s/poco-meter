CREATE TABLE `border_days` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`close_time` text NOT NULL,
	`ranks_json` text NOT NULL,
	`source_url` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `border_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`last_attempt` text DEFAULT '' NOT NULL,
	`last_success` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL
);

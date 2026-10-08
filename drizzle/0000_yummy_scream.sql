CREATE TABLE `voice_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`default_voice` text DEFAULT '' NOT NULL,
	`model` text DEFAULT 's2.1-pro-free' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voiceovers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`voice_id` text NOT NULL,
	`model` text NOT NULL,
	`speed` real NOT NULL,
	`status` text NOT NULL,
	`object_key` text,
	`bytes` integer,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voiceovers_request_unique` ON `voiceovers` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `voiceovers_user_created` ON `voiceovers` (`user_id`,`created_at`);
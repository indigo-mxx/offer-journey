CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`group_id` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`company` text NOT NULL,
	`position` text NOT NULL,
	`base` text DEFAULT '' NOT NULL,
	`batch` text NOT NULL,
	`status` text NOT NULL,
	`applied_at` text DEFAULT '' NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`link` text DEFAULT '' NOT NULL,
	`salary` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `applications_owner_email_idx` ON `applications` (`owner_email`);--> statement-breakpoint
CREATE INDEX `applications_group_id_idx` ON `applications` (`group_id`);--> statement-breakpoint
CREATE INDEX `applications_updated_at_idx` ON `applications` (`updated_at`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_email`)
);
--> statement-breakpoint
CREATE INDEX `group_members_user_email_idx` ON `group_members` (`user_email`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_email` text NOT NULL,
	`invite_code` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_invite_code_idx` ON `groups` (`invite_code`);--> statement-breakpoint
CREATE INDEX `groups_owner_email_idx` ON `groups` (`owner_email`);--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

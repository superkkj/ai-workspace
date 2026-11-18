CREATE TABLE `interests` (
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`request_id`, `user_id`),
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`provider_name` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`location` text NOT NULL,
	`min_participants` integer NOT NULL,
	`capacity` integer NOT NULL,
	`booking_url` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "proposals_price_nonnegative" CHECK("proposals"."price" >= 0),
	CONSTRAINT "proposals_capacity_range" CHECK("proposals"."capacity" BETWEEN 2 AND 30),
	CONSTRAINT "proposals_minimum_range" CHECK("proposals"."min_participants" BETWEEN 1 AND "proposals"."capacity"),
	CONSTRAINT "proposals_duration_range" CHECK("proposals"."duration_minutes" BETWEEN 15 AND 720)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_request_provider_unique` ON `proposals` (`request_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `registrations` (
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`request_id`, `user_id`),
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`region` text NOT NULL,
	`preferred_time` text NOT NULL,
	`budget` integer NOT NULL,
	`target_people` integer NOT NULL,
	`deadline` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`selected_proposal_id` text,
	`cancellation_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "requests_budget_nonnegative" CHECK("requests"."budget" >= 0),
	CONSTRAINT "requests_target_range" CHECK("requests"."target_people" BETWEEN 2 AND 30),
	CONSTRAINT "requests_status_allowed" CHECK("requests"."status" IN ('open', 'confirming', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `requests_created_idx` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `requests_owner_idx` ON `requests` (`owner_id`);
ALTER TABLE `requests` ADD `operation_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `requests_owner_operation_unique` ON `requests` (`owner_id`,`operation_id`);
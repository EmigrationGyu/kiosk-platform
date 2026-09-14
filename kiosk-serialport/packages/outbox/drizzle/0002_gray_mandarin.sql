ALTER TABLE `outbox_mutation` ADD `supersede_key` text;--> statement-breakpoint
CREATE INDEX `idx_outbox_supersede` ON `outbox_mutation` (`supersede_key`);
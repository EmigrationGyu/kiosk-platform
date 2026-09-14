CREATE TABLE `outbox_dependency` (
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	PRIMARY KEY(`parent_id`, `child_id`),
	FOREIGN KEY (`parent_id`) REFERENCES `outbox_mutation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `outbox_mutation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_outbox_dep_no_self" CHECK("outbox_dependency"."parent_id" != "outbox_dependency"."child_id")
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_dep_child` ON `outbox_dependency` (`child_id`);--> statement-breakpoint
CREATE TABLE `outbox_mutation` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer NOT NULL,
	`pending_deps_count` integer DEFAULT 0 NOT NULL,
	`on_dep_fail` text DEFAULT 'CANCEL' NOT NULL,
	`root_id` text NOT NULL,
	`resolution_reason` text,
	`initial_backoff_ms` integer DEFAULT 60000 NOT NULL,
	`max_backoff_ms` integer DEFAULT 480000 NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "chk_outbox_attempts_nonneg" CHECK("outbox_mutation"."attempts" >= 0),
	CONSTRAINT "chk_outbox_pending_deps_nonneg" CHECK("outbox_mutation"."pending_deps_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_picker` ON `outbox_mutation` (`status`,`pending_deps_count`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_outbox_root` ON `outbox_mutation` (`root_id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_expiry` ON `outbox_mutation` (`status`,`expires_at`);
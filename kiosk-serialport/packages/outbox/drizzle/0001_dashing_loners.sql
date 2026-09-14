ALTER TABLE `outbox_dependency` ADD `settled` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `outbox_dependency` SET `settled` = 1
WHERE `parent_id` IN (
	SELECT `id` FROM `outbox_mutation` WHERE `status` IN ('SUCCESS', 'RESOLVED_EXTERNAL')
)
OR (
	`parent_id` IN (SELECT `id` FROM `outbox_mutation` WHERE `status` IN ('DEAD', 'EXPIRED'))
	AND `child_id` IN (SELECT `id` FROM `outbox_mutation` WHERE `on_dep_fail` = 'PROCEED')
);
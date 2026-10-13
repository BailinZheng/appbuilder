CREATE TABLE "hosting_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"kind" text NOT NULL,
	"hosted_until" timestamp NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosting_reminders" ADD CONSTRAINT "hosting_reminders_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hosting_reminders_once_idx" ON "hosting_reminders" USING btree ("app_id","kind","hosted_until");
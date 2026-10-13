CREATE TABLE "free_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"app_id" text,
	"ip_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "free_previews" ADD CONSTRAINT "free_previews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_previews" ADD CONSTRAINT "free_previews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "free_previews_user_idx" ON "free_previews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "free_previews_ip_idx" ON "free_previews" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "free_previews_created_idx" ON "free_previews" USING btree ("created_at");
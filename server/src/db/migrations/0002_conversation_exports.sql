CREATE TABLE "conversation_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"session_id" uuid,
	"conversation_id" uuid NOT NULL,
	"conversation_title" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"message_count" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"device" jsonb,
	"time_zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"conversation_id" uuid NOT NULL,
	"chars" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"week_start" date PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD CONSTRAINT "conversation_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD CONSTRAINT "conversation_exports_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_exports_user_id" ON "conversation_exports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_exports_created_at" ON "conversation_exports" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "conversation_exports_sha256" ON "conversation_exports" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "message_events_created_at" ON "message_events" USING btree ("created_at");
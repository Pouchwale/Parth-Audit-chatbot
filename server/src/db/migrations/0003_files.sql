CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"conversation_id" uuid,
	"origin" text NOT NULL,
	"connector_id" text,
	"action_id" uuid,
	"filename" text NOT NULL,
	"relative_path" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"data" "bytea" NOT NULL,
	"text" text,
	"text_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_exports" ALTER COLUMN "message_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_exports" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD COLUMN "kind" text DEFAULT 'conversation' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD COLUMN "purpose" text DEFAULT 'download' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_exports" ADD COLUMN "content_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "attachments" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_conversation_id" ON "files" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "files_created_at" ON "files" USING btree ("created_at");
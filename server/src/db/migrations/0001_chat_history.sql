ALTER TABLE "conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "transcript" jsonb DEFAULT '[]'::jsonb NOT NULL;
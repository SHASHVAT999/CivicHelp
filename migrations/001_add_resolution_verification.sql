-- CivicHelp Migration: 001_add_resolution_verification.sql
-- Description: Adds resolution proof and citizen verification fields to the complaints table.
-- Existing resolved complaints default to 'not_required' so they do not falsely require verification.
--
-- How to apply to an existing database:
-- 1. Direct MySQL CLI:
--    mysql -u <db_user> -p <db_password> civichelp < migrations/001_add_resolution_verification.sql
-- 2. Docker Compose:
--    docker compose exec -T db mysql -u civichelp -p<password> civichelp < migrations/001_add_resolution_verification.sql

USE civichelp;

ALTER TABLE complaints
  ADD COLUMN resolution_image_url VARCHAR(255) NULL AFTER resolved_at,
  ADD COLUMN resolution_notes TEXT NULL AFTER resolution_image_url,
  ADD COLUMN citizen_confirmation_status ENUM('not_required', 'pending', 'confirmed', 'reopened') DEFAULT 'not_required' AFTER resolution_notes,
  ADD COLUMN citizen_feedback TEXT NULL AFTER citizen_confirmation_status,
  ADD COLUMN citizen_feedback_at TIMESTAMP NULL AFTER citizen_feedback;

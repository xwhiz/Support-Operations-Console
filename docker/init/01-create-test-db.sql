-- Runs once on first Postgres init. Creates the dedicated test database used by
-- the integration/concurrency test suite (see TEST_DATABASE_URL).
CREATE DATABASE support_console_test;

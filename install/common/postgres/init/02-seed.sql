SET default_transaction_read_only = off;

\connect wikijump

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET default_toast_compression = lz4;
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT ALL ON SCHEMA public TO wikijump;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

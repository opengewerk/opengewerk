-- The zero rate for photovoltaics, section 12 (3) UStG: #127.
--
-- Comes from the schema. The rate itself, 0 percent from 1 January 2023, is a
-- record in the package `vat` and not in this file; the enum only lets a line
-- name it. A value added to an enum may not be used in the transaction that
-- adds it, and every pending migration runs in one, so nothing here or in a
-- later migration of the same run may write it.
ALTER TYPE "public"."vat_rate" ADD VALUE 'zero';

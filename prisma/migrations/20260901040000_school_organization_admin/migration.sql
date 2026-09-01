-- Keep the enum change isolated. PostgreSQL does not let a newly-added enum
-- value participate in constraints until the transaction that adds it commits.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';

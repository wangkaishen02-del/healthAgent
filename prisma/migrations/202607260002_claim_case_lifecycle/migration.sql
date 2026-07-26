ALTER TYPE "ClaimCaseStatus" RENAME VALUE 'submitted' TO 'processing';
ALTER TYPE "ClaimCaseStatus" ADD VALUE 'completed' AFTER 'processing';

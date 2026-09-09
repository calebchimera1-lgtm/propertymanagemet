-- One account per email address, platform-wide.
--
-- The composite unique on (organizationId, email) is kept: it is the natural
-- key inside an organization and Prisma uses it for upserts. But on its own it
-- would allow the same address in two organizations, which makes signing in
-- with an email alone ambiguous — there would be no way to tell which account
-- the password belongs to.
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

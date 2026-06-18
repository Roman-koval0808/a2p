# Prisma Migration Guide

This project has been migrated from PocketBase to PostgreSQL with Prisma.

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up your database:**

   - Create a PostgreSQL database
   - Add the connection string to your `.env` file:
     ```
     DATABASE_URL="postgresql://user:password@localhost:5432/lead_grabber?schema=public"
     ```

3. **Generate Prisma Client:**

   ```bash
   npm run db:generate
   ```

4. **Push the schema to your database:**

   ```bash
   npm run db:push
   ```

   Or create a migration:

   ```bash
   npm run db:migrate
   ```

## Schema Overview

All PocketBase collections have been converted to Prisma models:

### Auth Models

- `User` - Regular users (from `users` collection)
- `SuperUser` - System administrators (from `_superusers` collection)
- `AuthOrigin` - Authentication origins tracking
- `ExternalAuth` - OAuth/external authentication
- `Mfa` - Multi-factor authentication
- `Otp` - One-time passwords

### Application Models

- `Company` - Companies/organizations
- `CompanyMember` - Company membership with roles
- `Contact` - Customer contacts
- `CommunicationLog` - Communication history
- `Invite` - Team invitations
- `Leadbox` - Lead capture boxes
- `Leadform` - Lead capture forms
- `Logo` - Logo storage
- `Message` - Message threads

## Key Differences from PocketBase

1. **IDs**: Prisma uses `cuid()` by default instead of PocketBase's 15-character IDs. If you need to preserve existing IDs, you'll need to handle the migration separately.

2. **File Storage**: File fields (like `avatar`, `logo`) are stored as strings (file paths/URLs) instead of PocketBase's file system. You'll need to implement file storage separately (e.g., S3, local filesystem).

3. **Relations**: Many-to-many relationships use explicit join tables (e.g., `CommunicationLogAssignedMember`) instead of PocketBase's relation arrays.

4. **Authentication**: You'll need to implement authentication logic using bcryptjs for password hashing and JWT tokens for sessions.

## Next Steps

1. Update all code that uses `pb.collection()` to use Prisma client instead
2. Implement authentication middleware
3. Set up file storage for file fields
4. Migrate existing data if needed
5. Update API routes to use Prisma queries

## Useful Commands

- `npm run db:studio` - Open Prisma Studio to view/edit data
- `npm run db:generate` - Regenerate Prisma Client after schema changes
- `npm run db:push` - Push schema changes to database (development)
- `npm run db:migrate` - Create a migration (production)

# Database Management

## Overview
Version-based migration system for Ivaa AdSync database.

## Files
- `migrate.js` - Migration system with up/down support
- `seed.js` - Optional test data seeding

## Commands

### Run Migrations (Setup or Update)
```bash
npm run db:migrate
```
Applies all pending migrations in order.

### Rollback Last Migration
```bash
npm run db:rollback
```
Undoes the most recent migration.

### Reset Database (DANGER!)
```bash
npm run db:reset
```
Drops all tables and data. Use with caution!

### Add Test Data
```bash
npm run db:seed
```

## Features

### Payment System
- **Credit Balance**: Pre-paid system (£3 per content upload)
- **Free Upload**: 1 free upload per month per shop
- **Payment Status**: active/inactive/terminated
- **Billing**: Monthly invoices for screen subscriptions
- **Enforcement**: 7-day grace → inactive, 30-day → deletion

### Content Workflow
6-state workflow:
1. `pending` - Uploaded by shop owner
2. `in_design` - Designer working on it
3. `designed` - Designer submitted design
4. `approved` - Admin approved
5. `rejected` - Admin rejected (can re-design)
6. `published` - Designer published to screens

### Tables
- `users` - Authentication (admin, designer, owner)
- `shops` - Shop profiles with credit balance
- `screens` - Display screens (32/43/55 inch)
- `content` - Media content with workflow tracking
- `playlists` - Content playlists
- `billing` - Monthly invoices
- `credit_transactions` - Credit audit trail
- `notifications` - System notifications
- `support_tickets` - Support system

## Important Notes
- Always backup database before running setup
- Setup is idempotent (safe to run multiple times)
- Adds courtesy credit only to shops without credit
- All monetary values in GBP (£)
# Ivaa AdSync Backend API

## Overview
Backend API for Ivaa AdSync digital signage system. Built with Node.js, Express, and PostgreSQL.

## Prerequisites
- Node.js 16+ 
- PostgreSQL 13+
- npm or yarn

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Database Setup

#### Option A: Complete Schema Setup (Recommended for new installations)
```bash
npm run db:setup
```

#### Option B: Manual PostgreSQL Setup
Create a PostgreSQL database:
```sql
CREATE DATABASE ivaa_adsync;
```

Run the schema:
```bash
psql -U postgres -d ivaa_adsync -f src/database/schema.sql
```

#### Option C: Migration System (For updates)
```bash
# Check migration status
npm run db:migrate:status

# Apply pending migrations
npm run db:migrate
```

### 3. Environment Variables
Copy `.env.example` to `.env` and update:
```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (default: 5000)
- `FRONTEND_URL` - Frontend URL for CORS

### 4. Run Development Server
```bash
npm run dev
```

Server will start on http://localhost:5000

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - Register new shop owner
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/auth/change-password` - Change password

### Shops (Protected)
- `GET /api/shops` - List all shops (Admin only)
- `GET /api/shops/:id` - Get shop details
- `POST /api/shops` - Create new shop (Admin only)
- `PUT /api/shops/:id` - Update shop
- `DELETE /api/shops/:id` - Delete shop (Admin only)

### Screens (Protected)
- `GET /api/screens/shop/:shopId` - Get screens for a shop
- `GET /api/screens/:id` - Get screen details
- `POST /api/screens` - Add new screen
- `PUT /api/screens/:id` - Update screen
- `DELETE /api/screens/:id` - Delete screen
- `POST /api/screens/:deviceId/heartbeat` - Device heartbeat

## Authentication
All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <token>
```

## Roles
- `admin` - Full system access
- `owner` - Shop owner, can manage own shop
- `sales` - Sales team member (limited access)

## Default Admin Account
- Email: admin@ivaa.com
- Password: (set during first login)

## Project Structure
```
src/
├── config/         # Database configuration
├── middleware/     # Auth and other middleware
├── routes/         # API routes
├── database/       # Schema and migrations
└── index.js        # Server entry point
```

## Production Deployment
1. Set `NODE_ENV=production`
2. Use environment variables for sensitive data
3. Enable SSL for database connection
4. Set up proper logging
5. Configure rate limiting

## Troubleshooting

### SSL Certificate Issues (DigitalOcean Managed Databases)
If you encounter SSL certificate errors like `self-signed certificate in certificate chain`:

#### Method 1: Environment Variable (Recommended for development)
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_ENV=production npm run db:setup
NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_ENV=production npm run db:migrate
```

#### Method 2: Update DATABASE_URL (Recommended for production)
Add SSL parameters to your DATABASE_URL:
```bash
DATABASE_URL=postgresql://user:pass@host:port/db?sslmode=require&sslcert=&sslkey=&sslrootcert=
```

#### Method 3: Use DigitalOcean CA Certificate
1. Download DigitalOcean's CA certificate:
```bash
wget https://docs.digitalocean.com/assets/ca-certificate.crt
```

2. Update DATABASE_URL:
```bash
DATABASE_URL=postgresql://user:pass@host:port/db?sslmode=require&sslrootcert=./ca-certificate.crt
```

### Database Migration Files
The project uses SQL-based migrations for better maintainability:

- **Initial setup**: `src/database/schema.sql` (complete schema)
- **Updates**: `src/database/migrations/001_description.sql` (incremental changes)

Migration file naming convention: `{number}_{description}.sql`

Example:
```
migrations/
├── 001_add_user_avatar.sql
├── 002_add_shop_settings.sql
└── 003_update_pricing.sql
```

## Support
For issues or questions, contact the development team.
# INFINITY BOX - Production Deployment

## Quick Start

1. Set your environment variables:
   ```bash
   export DATABASE_URL="your_postgresql_url"
   export NODE_ENV="production"
   export PORT="5000"
   export HOST="0.0.0.0"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

## Cloud Deployment

### Render.com
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Add your DATABASE_URL

### Railway
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Add your DATABASE_URL

### Heroku
- Buildpack: `heroku/nodejs`
- Start Command: `npm start`
- Config Vars: Add your DATABASE_URL

## Environment Variables Required

- `DATABASE_URL`: PostgreSQL connection string
- `NODE_ENV`: Set to "production"
- `PORT`: Server port (default: 5000)
- `HOST`: Server host (default: 0.0.0.0)

## Files Structure

- `server/`: TypeScript server files
- `shared/`: Shared schema and types
- `public/`: Built frontend assets
- `drizzle.config.ts`: Database configuration
- `package.json`: Production dependencies

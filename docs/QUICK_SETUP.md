# Quick Setup Guide

## Step 1: Run Database Migrations (Inside Container)

```bash
# Run all migrations inside the MySQL container
for file in scripts/sql/00{2,3,4,5}_*.sql; do
  echo "Running $(basename $file)..."
  docker compose exec -T mysql mysql -uroot -proot wealth_tracker < "$file"
done
```

## Step 2: Populate Metadata (On Host)

```bash
# Requires Node.js and yahoo-finance2 on your host machine
node scripts/populate_securities_metadata.js --all
```

## Step 3: (Optional) Populate Popular Securities

```bash
# Takes 5-6 minutes with 150 symbols
node scripts/populate_popular_securities.js --all
```

## Verify

```bash
# Check tables were created
docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SHOW TABLES;"

# Check metadata count
docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT COUNT(*) FROM securities_metadata;"

# View sample data
docker compose exec mysql mysql -uroot -proot wealth_tracker -e "SELECT symbol, short_name, quote_type FROM securities_metadata LIMIT 5;"
```

---

## Alternative: Run Everything from Host

If you have MySQL client installed on your host:

```bash
# Set environment variables
export MYSQL_HOST=localhost
export MYSQL_PORT=3307  # or whatever port you mapped
export MYSQL_USER=root
export MYSQL_PASSWORD=root
export MYSQL_DATABASE=wealth_tracker

# Run migrations
for file in scripts/sql/00{2,3,4,5}_*.sql; do
  mysql -h$MYSQL_HOST -P$MYSQL_PORT -u$MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < "$file"
done

# Populate metadata
node scripts/populate_securities_metadata.js --all
```

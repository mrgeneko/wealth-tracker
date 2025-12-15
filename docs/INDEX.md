# Documentation Index

Welcome to the wealth-tracker documentation. This folder contains organized guides for all aspects of the project.

## 📋 Quick Navigation

### 🏛️ [Architecture](architecture/)
High-level system design and refactoring documentation
- [Architecture Overview](architecture/ARCHITECTURE_REFACTORING_PLAN.md) - Planned 11-phase refactoring (✅ COMPLETE)
- [Implementation Summary](architecture/ARCHITECTURE_IMPLEMENTATION_SUMMARY.md) - What was actually built and deployed

### 🔌 [API Reference](api/)
API documentation and integration guides
- [API Reference](api/API_REFERENCE.md) - Complete REST API documentation
- [API Scraper Service](api/API_SCRAPER_SERVICE.md) - HTTP-based price scraping
- [Metadata API Integration](api/METADATA_API_INTEGRATION.md) - Ticker metadata service

### 🛠️ [Services](services/)
Documentation for core system services
- [Listing Sync Service](services/LISTING_SYNC_SERVICE.md) - NASDAQ/NYSE listing management
- [Metadata System](services/METADATA_SYSTEM_COMPLETE.md) - Security metadata storage
- [Watchlist Providers](services/WATCHLIST_PROVIDERS.md) - Multi-provider watchlist support
- [Security Metadata](services/SECURITY_METADATA.md) - Type detection and bond identification

### 🚀 [Operations](operations/)
Deployment, configuration, and operational guides
- [Quick Setup](QUICK_SETUP.md) - Get started in 5 minutes
- [Setup Script Usage](operations/SETUP_SCRIPT_USAGE.md) - Detailed setup process
- [Cron Installation](operations/CRON_INSTALLATION.md) - Configure periodic jobs
- [Cron Reinstall](operations/CRON_REINSTALL.md) - Restore cron jobs
- [Exchange Data Updates](operations/exchange_data_update.md) - Sync ticker listings
- [TTM Migration Plan](operations/TTM_dividends_earnings_migration_plan.md) - Data migration guide

### 📦 [Archive](archive/)
Historical documentation and phase tracking (for reference)
- [Phase History](archive/phase-history/) - Phase 4-10 planning and completion records
- [One-Off Fixes](archive/one-off-fixes/) - Historical bug fixes and one-time setup notes

---

## 📚 Key Documents

### Getting Started
1. Read [Quick Setup](QUICK_SETUP.md) - 5 minute setup guide
2. Check [API Reference](api/API_REFERENCE.md) - Understand available endpoints
3. Review [Architecture](architecture/ARCHITECTURE_REFACTORING_PLAN.md) - Understand system design

### Running Operations
- **Deploy**: See [operations/](operations/) folder
- **Setup Cron**: [Cron Installation](operations/CRON_INSTALLATION.md)
- **Manage Tickers**: [Listing Sync Service](services/LISTING_SYNC_SERVICE.md)
- **Check Status**: [API Reference](api/API_REFERENCE.md#health-endpoints)

### Understanding the System
- **Overall Design**: [Architecture Overview](architecture/ARCHITECTURE_REFACTORING_PLAN.md)
- **What Was Built**: [Implementation Summary](architecture/ARCHITECTURE_IMPLEMENTATION_SUMMARY.md)
- **Services**: [Services Folder](services/)
- **Known Issues**: [Known Issues & TODO](KNOWN_ISSUES.md)

### Troubleshooting
- [Known Issues & TODO](KNOWN_ISSUES.md) - Current backlog and limitations
- [One-Off Fixes](archive/one-off-fixes/) - Past issues and solutions
- [Phase History](archive/phase-history/) - Implementation decisions and lessons

---

## 📊 Document Organization

```
docs/
├── INDEX.md (this file)
├── QUICK_SETUP.md
├── KNOWN_ISSUES.md
│
├── architecture/
│   ├── ARCHITECTURE_REFACTORING_PLAN.md
│   └── ARCHITECTURE_IMPLEMENTATION_SUMMARY.md
│
├── api/
│   ├── API_REFERENCE.md
│   ├── API_SCRAPER_SERVICE.md
│   └── METADATA_API_INTEGRATION.md
│
├── services/
│   ├── LISTING_SYNC_SERVICE.md
│   ├── METADATA_SYSTEM_COMPLETE.md
│   ├── WATCHLIST_PROVIDERS.md
│   └── SECURITY_METADATA.md
│
├── operations/
│   ├── SETUP_SCRIPT_USAGE.md
│   ├── CRON_INSTALLATION.md
│   ├── CRON_REINSTALL.md
│   ├── exchange_data_update.md
│   └── TTM_dividends_earnings_migration_plan.md
│
└── archive/
    ├── phase-history/
    │   ├── PHASE_4_SUMMARY.md
    │   ├── PHASE_8_PLAN.md
    │   ├── PHASE_9_*.md (multiple)
    │   ├── IMPLEMENTATION_PROGRESS.md
    │   └── TEST_RESULTS_SUMMARY.md
    │
    └── one-off-fixes/
        ├── FRESH_CONTAINER_FIXES_SUMMARY.md
        ├── GITHUB_ACTIONS_PERMISSION_FIX.md
        ├── INTEGRATION_TEST_FIXES_SUMMARY.md
        ├── METADATA_FIX_COMMIT.md
        ├── SCHEMA_*.md
        ├── CONSOLIDATION_SUMMARY.md
        └── TICKER_STANDARDIZATION.md
```

---

## 🔄 Recent Changes

**December 15, 2025**: Documentation reorganization
- ✅ Created organized folder structure (architecture/, api/, services/, operations/)
- ✅ Archived historical phase documentation to archive/
- ✅ Removed duplicate/obsolete status marker files
- ✅ Created KNOWN_ISSUES.md from legacy todo list
- ✅ Consolidated 63+ scattered markdown files into logical groups

---

## 🤔 Need Help?

- **Quick Start**: See [QUICK_SETUP.md](QUICK_SETUP.md)
- **API Questions**: Check [API Reference](api/API_REFERENCE.md)
- **System Design**: Read [Architecture Overview](architecture/ARCHITECTURE_REFACTORING_PLAN.md)
- **Operations Issues**: See [Operations Guides](operations/)
- **Known Limitations**: Review [Known Issues](KNOWN_ISSUES.md)

---

**Last Updated**: December 15, 2025  
**Total Documents**: ~50 organized + archived

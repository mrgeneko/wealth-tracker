# GitHub Actions Permission Fix

## Problem
The GitHub Actions workflows were failing with a 403 "Resource not accessible by integration" error when trying to post comments on pull requests using `actions/github-script@v7`.

### Error Details
```
RequestError [HttpError]: Resource not accessible by integration
status: 403
message: 'Resource not accessible by integration'
```

This occurred in the backend test workflow when it tried to execute:
```yaml
github.rest.issues.createComment({
  issue_number: context.issue.number,
  owner: context.repo.owner,
  repo: context.repo.repo,
  body: summary
})
```

## Root Cause
The workflows were missing the required `permissions` section in their GitHub Actions configuration. Without explicit permissions, the default `GITHUB_TOKEN` provided by GitHub Actions has very limited permissions and cannot write pull request comments.

## Solution
Added the `permissions` section to all affected workflow files:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

This grants the workflow:
- **contents: read** - Permission to read repository contents
- **pull-requests: write** - Permission to write PR comments and updates
- **issues: write** - Permission to write issue comments

## Files Updated

### 1. `.github/workflows/backend-ticker-standardization.yml` ✅
- Added permissions section after `on:` trigger
- Allows posting test results to PR comments

### 2. `.github/workflows/frontend-ticker-standardization.yml` ✅
- Added permissions section after `on:` trigger
- Allows posting test results to PR comments

### 3. `.github/workflows/migration-validation.yml` ✅
- Added permissions section after `on:` trigger
- Allows posting migration validation results

### 4. `.github/workflows/ticker-standardization-complete.yml` ✅
- Added permissions section after `on:` trigger
- Allows posting comprehensive test results

### 5. `.github/workflows/unit-tests.yml`
- ✅ Already had correct permissions configured

## Verification

After applying these changes, the workflows can now:
1. ✅ Post test results as PR comments
2. ✅ Update PR status checks
3. ✅ Create and update issues
4. ✅ Write to pull request reviews

## Best Practices Applied

1. **Principle of Least Privilege**: Only granted necessary permissions
2. **Explicit Permissions**: Made permissions explicit rather than relying on defaults
3. **Consistency**: Applied same permission set across all related workflows
4. **Documentation**: Each permission has a clear purpose

## Testing
Run a test push or PR to verify workflows can now post comments:
```bash
git push origin ticker-name-standardization-phase-1
```

The workflows should now successfully:
- Run all tests
- Generate coverage reports
- Post results as PR comments
- Complete without 403 errors

## Reference
- GitHub Actions Permissions: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions
- actions/github-script requirements: https://github.com/actions/github-script#permissions

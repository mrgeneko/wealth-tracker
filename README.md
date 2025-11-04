wealth_tracker
=========

Developer README — minimal run instructions and notes.

What changed
------------
- The repository was refactored into a package: all canonical implementations live under the `wealth_tracker/` package.
- Top-level Python shim files and top-level script `.py` files were removed to avoid duplication. Use the package entrypoints instead.

Quick setup (developer, editable install)
----------------------------------------
1) Use your preferred Python (the repo was tested with pyenv Python 3.13.3):

```bash
# example using pyenv-managed Python
/Users/gene/.pyenv/versions/3.13.3/bin/python -m pip install -e .
```

2) Run a smoke-import check (this verifies the package imports):

```bash
/Users/gene/.pyenv/versions/3.13.3/bin/python -c "import importlib,sys; mods=['wealth_tracker','wealth_tracker.publish_to_kafka','wealth_tracker.write_price_data_to_mysql','wealth_tracker.parse_investing_com_html'];
ok=True
for m in mods:
    try:
        importlib.import_module(m)
        print(m,'OK')
    except Exception as e:
        print(m,'ERROR',e); ok=False
if not ok: sys.exit(2)
print('SMOKE_IMPORTS_OK')"
```

Running dev services (Kafka/MySQL)
---------------------------------
- Kafka (dev) is configured in `docker-compose.kafka.yml`. From the repo root:

```bash
docker compose -f docker-compose.kafka.yml up -d
```

- For MySQL dev, you can run a MySQL container (example):

```bash
docker run -d --name wealth-tracker-mysql -e MYSQL_ROOT_PASSWORD=rootpass -e MYSQL_DATABASE=testdb -e MYSQL_USER=test -e MYSQL_PASSWORD=test -p 3306:3306 mysql:8.0
```

Scripts / entrypoints
---------------------
- Scripts are now packaged under `wealth_tracker.scripts` and should be executed with the `-m` flag, for example:

```bash
python -m wealth_tracker.scripts.publish_test_message
python -m wealth_tracker.scripts.consume_kafka_test --from-beginning --num 1
```

Notes & troubleshooting
-----------------------
- If you relied on running top-level `scripts/*.py` previously, switch to the `python -m` form above. The top-level `.py` script duplicates were intentionally removed to reduce duplication.
- If editable install fails, ensure you are using a compatible pip/python and that `pyproject.toml` is present.

Next steps (recommended)
------------------------
- Add a small GitHub Actions workflow to run the smoke-import check on PRs.
- Add unit tests under `tests/` for the MySQL writer and Kafka publisher (use mocks or sqlite for fast tests).

Contact
-------
If anything here looks wrong or you prefer keeping top-level runnable .py scripts as shims, tell me and I will restore thin stubs that call the package entrypoints.

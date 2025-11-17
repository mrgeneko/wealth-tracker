## Building Chrome SingleFile Container on Apple Silicon (M1/M2/M3 Mac)

If you are using Docker Desktop on Apple Silicon and want to run Google Chrome (x86_64/amd64) in a container, you must:

1. Enable "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop settings.
2. Build and run your container with the amd64 platform specified:
     - For Docker Compose:
         ```sh
         docker compose build --platform linux/amd64
         docker compose up --platform linux/amd64
         ```
     - For direct Docker builds:
         ```sh
         docker build --platform linux/amd64 -t wealth-tracker-scrapers -f Dockerfile.scrapers .
         ```

This ensures the container uses x86_64 emulation and can install Google Chrome for amd64.
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

===============================





=======================

To use the Chrome Web Store version of an extension in Docker (headless Chrome), you need to:

Download the extension as a .crx file or extract it to a folder.
Unpack the .crx (if needed) to a directory in your Docker image.
Use the --load-extension=/path/to/extension flag when launching Chrome.
However, Chrome does not natively download extensions from the Web Store via command line or Docker. You must manually download the extension, unpack it, and add it to your build context.

Steps:

Go to the SingleFile Chrome Web Store page: https://chrome.google.com/webstore/detail/singlefile/mpiodijhokgodhhofbcjdecpffjipkle
Use a Chrome extension downloader (such as "CRX Extractor/Downloader" or a service like https://crxextractor.com/) to download the .crx file.
Unzip the .crx file (it’s just a zip archive).
Copy the extracted folder into your project (e.g., singlefile-extension/).
In your Dockerfile, copy this folder into the image:
Use the same Chrome launch command:
Would you like step-by-step instructions for downloading and unpacking the extension, or help updating your Dockerfile to use a local extension folder?
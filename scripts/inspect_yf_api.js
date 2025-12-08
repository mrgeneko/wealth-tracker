(async () => {
  try {
    console.log('CWD', process.cwd());
    let mod;
    try {
      mod = require('yahoo-finance2');
      console.log('Require succeeded - typeof', typeof mod);
      if (typeof mod === 'function' || typeof mod === 'object') {
        console.log('Keys:', Object.keys(mod).slice(0, 300));
      }
    } catch (err) {
      console.log('Require failed:', err.message);
    }
    try {
      const imp = await import('yahoo-finance2');
      const m = imp && imp.default ? imp.default : imp;
      console.log('Import succeeded - typeof', typeof m);
      if (typeof m === 'function' || typeof m === 'object') {
        console.log('Keys:', Object.keys(m).slice(0, 300));
      }
      if (typeof m === 'function') {
        // Also instantiate and inspect instance keys if it's a class
        try {
          const inst = new m();
          console.log('Instance keys:', Object.keys(inst).slice(0, 300));
        } catch (e) {
          console.log('Instantiation failed:', e.message);
        }
      }
    } catch (err) {
      console.log('Import failed:', err.message);
    }
  } catch (e) {
    console.error('Unhandled:', e);
  }
})();

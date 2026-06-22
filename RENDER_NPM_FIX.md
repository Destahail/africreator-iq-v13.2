# Render npm deployment fix

## Cause
The previous `package-lock.json` files contained package archive URLs from a private build environment. Render could not access those URLs, causing npm to stop with `Exit handler never called!`.

## Permanent fix included
- Backend and frontend lockfiles now use `https://registry.npmjs.org`.
- Backend and frontend contain `.npmrc` files that explicitly select the public npm registry.
- Node/npm requirements are declared in each `package.json`.
- Both dependency installs and the frontend production build were retested successfully.

## Render settings
- Root Directory: `backend`
- Build Command: `npm ci --no-audit --no-fund`
- Start Command: `npm start`

After updating the GitHub repository, use **Clear build cache and deploy** in Render.

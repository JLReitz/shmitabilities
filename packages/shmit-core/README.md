# shmit-core

`@jlreitz/shmit-core` supplies account-scoped location and shared TOML settings
reads to Shmitabilities capability packages.

```ts
import {locateManagedAgentRoot, locateSharedSettingsRoot, readSharedSettings} from '@jlreitz/shmit-core';

const agentRoot = locateManagedAgentRoot();
const settings = await readSharedSettings();
```

The reader returns an empty object when the shared settings file is absent.
Each capability defines and validates the settings it uses, including defaults
for absent values. Read and TOML parse errors reach the caller.

Build with `npm ci` and `npm run build` from this directory. Run `npm run format`
to format source and `npm run format:check` to verify it. See the repository's
`docs/packages.md` for the package boundary and `docs/dependencies.md` for
dependency installation and verification.

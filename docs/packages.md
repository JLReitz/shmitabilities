# Package contracts

Shmitabilities packages can share account-scoped settings while each capability defines its
own settings and runtime behavior. `@jlreitz/shmit-core` supplies the managed agent root and
reads the shared settings file. A capability package interprets the values it uses.

## Default client resources

```text
Root package installation
  | Pi: pi.skills                     | DSH: dsh.bundle.patch
  v                                   v
Pi skill loader               DSH filesystem skill provider
  | reads skills/                     | scans skills/
  +--------------> skills/ <----------+
```

The root `package.json` registers `skills/` for Pi and declares a DSH bundle patch in
`cordis.patch.yml`. Pi reads `pi.skills` when the root is installed as a local package. DSH
applies the patch when the root is added to a profile; the patch registers a filesystem skill
provider for the same directory. Both clients then load the skill files from this checkout.
The default capability package set is empty. Install capability packages separately when their
behavior is required; see [Client installation and loading](dependencies.md#client-installation-and-loading).

```text
Capability entry
  │ request managed root + shared settings
  ▼
shmit-core
  │ root + parsed settings, including absent values
  ▼
Capability configuration adapter
  │ validated values + capability defaults
  ▼
Capability runtime and client interfaces
```

## Shared configuration

`@jlreitz/shmit-core` exports `locateManagedAgentRoot()`, `locateSharedSettingsRoot()`,
and `readSharedSettings(settingsRoot?)`. The first returns `${HOME}/.agents` for the current
account. The second returns `${HOME}/.config/shmit`. The reader loads `settings.toml` from
that settings root and returns parsed TOML values.
When the file or a parent directory is absent, it returns an empty object. Other filesystem
errors and TOML parse errors reach the caller.

The optional root argument selects another settings root. Reads follow filesystem symlinks
and run on each call. The package keeps no cache or persistent state. The account maintains the
settings file. A capability can import the compiled public entry without loading Pi or DSH.

## Capability packages

Each capability defines the structure, valid values, defaults, and missing-value behavior for
its settings. A capability imports `@jlreitz/shmit-core`, reads the shared settings, and
interprets its own keys. Native client files define provider and model registrations; the
capability package defines client interfaces and runtime lifecycle. Build `shmit-core` before a
package that imports its compiled entry; see
[Shared Node packages](dependencies.md#shared-node-packages).

The [llamas-and-shmit package README](../packages/llamas-and-shmit/README.md) defines its
settings, native llama.cpp catalog, Pi and DSH interfaces, router lifecycle, validation, and
installation limits.

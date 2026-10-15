# Hook entry requirements

Hook entry points MAY invoke scripts that integrate with workspace infrastructure.

## Exit contract

- Return `0` to allow the client event or report success. The hook MAY write structured JSON defined by the session host client to stdout.
- Return `2` for an unhandled error or exception. Print the raised description verbatim to stderr.

# Contributing to CodeDelta

Thanks for helping improve CodeDelta.

## Development

1. Clone the repository.
2. Open it in VS Code.
3. Press `F5` to launch an Extension Development Host.
4. Run the test suite before submitting changes:

```bash
npm test
```

## Pull requests

Keep changes focused and include tests for tracking/counting behavior when practical. Changes that affect counting semantics should also update `README.md` and `CHANGELOG.md`.

## Bug reports

For counting bugs, please include:

- whether the change was made in the VS Code editor or directly on disk by an external tool;
- the file type/language;
- the expected `+/-` delta and the observed delta;
- whether the file was created, deleted, renamed, or modified.

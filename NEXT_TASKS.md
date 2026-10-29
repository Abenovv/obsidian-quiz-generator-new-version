# Maintenance

- Keep the 3.0.1 vendor files immutable. Review the compatibility bridge before replacing them.
- Gradually migrate remaining study-runtime modules into typed source with behavior-preserving regression tests.
- Verify future Obsidian/API compatibility against official documentation and fixture-based tests before changing provider defaults.
- Keep release assets limited to the runtime files and checksums. Never include local settings or study history.

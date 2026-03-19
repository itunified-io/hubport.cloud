# hubport.cloud

Self-hosted congregation management platform — always free, source-available under MIT + Commons Clause.

## Architecture
- **Central API** (`central-api/`) — tenant registry, sharing, provisioning
- **Self-hosted Docker stack** (coming soon) — hub-app, hub-api, Keycloak, Vault, PostgreSQL
- **Landing page** — [cf-hubport-cloud](https://github.com/itunified-io/cf-hubport-cloud) (CF Worker)

## Development

```bash
npm install
npm run dev       # start central-api dev server
npm test          # run tests
npm run build     # build for production
```

## License
MIT + Commons Clause — free for non-commercial use. See [LICENSE](LICENSE) for details.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md)

## Sponsors
This project is always free. Support via [GitHub Sponsors](https://github.com/sponsors/itunified-io).

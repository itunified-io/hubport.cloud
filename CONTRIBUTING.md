# Contributing to hubport.cloud

Thank you for your interest in contributing!

## How to Contribute

1. **Fork** the repository
2. **Create a feature branch** from `main`: `git checkout -b feature/your-feature`
3. **Make your changes** and commit with a clear message
4. **Push** to your fork and open a Pull Request

## Development Setup

```bash
npm install
cd central-api && npx prisma generate
npm run dev
```

## Code Style

- TypeScript strict mode
- Fastify v5 with TypeBox validation
- Prisma for database access
- All endpoints documented in route files

## Reporting Issues

Open a GitHub issue with steps to reproduce.

## License

By contributing, you agree that your contributions will be licensed under GPL-3.0-or-later.
